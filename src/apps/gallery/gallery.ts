import { ConsumerBuilder, MessageHandler } from "pgstream";
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { env } from "../../utils/env";
import { pino } from 'pino';
import { GalleryRc } from "./galleryrc";
import { createHash } from "node:crypto";
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { Knex } from "knex";
import { ImportFinished } from "../../events/ImportFinished";
import pmap from 'p-map';

const log = pino({
    level: env('LOG_LEVEL', 'debug')
});

const GALLERY_THUMBNAIL_PATH = env('GALLERY_THUMBNAIL_PATH');
const CORE = 'core';
const GALLERY = 'gallery';
const SUPPORTED_EXTENSIONS = [ '.jpg', '.jpeg' ];
const THUMBNAIL_VARIANTS = [{
    // variant 0 - small preview on index
    w: 160,
    h: 100,
    quality: 75
    // NOTE: For now, all thumbnails are JPEG - WebP gives marginal gains.
}, {
    // variant 1 - large preview (720p + vertical pixels for 16:10)
    w: 1280,
    h: 800,
    quality: 92
}];
const CONCURRENCY = 2;

function sha256(input: Buffer) {
    return createHash('sha256').update(input).digest();
}

async function importImages(import_id: string, tree_id: number, trx: Knex, directoryAccumulator: Set<string>) {
    // First, detect all new or changed images:
    const entries = await trx('entries')
        .withSchema(CORE)
        .select('path', 'mtime')
        .where({
            tree_id: tree_id,
            last_change_at: import_id,
            type: 'file'
        })
        .whereIn('ext1', SUPPORTED_EXTENSIONS);
    // NOTE: If this seems to consume too much memory, try using .stream()
    await pmap(entries, async (entry) => {
        try {
            // We know the file is new or modified, so we need to inspect it either way:
            const fileContents = await fs.readFile(entry.path);
            const fileHash = sha256(fileContents);
            const picMetadata = await sharp(fileContents).metadata();
            const exif = picMetadata.exif ? exifReader(picMetadata.exif) : null;
            // TODO: Check if timestamp is correct or offset by timezone.
            const taken_at: Date = (exif?.exif?.DateTimeOriginal as Date) ?? new Date(entry.mtime);
            // Add the image to the database along with all metadata:
            await trx('images')
                .withSchema(GALLERY)
                .insert({
                    tree_id,
                    path: entry.path,
                    ver: import_id,
                    sha256: fileHash,
                    w: picMetadata.width ?? 0,
                    h: picMetadata.height ?? 0,
                    taken_at,
                    // TODO: Fix and sanitize EXIF!
                    exif: null
                }).onConflict([ 'tree_id', 'path' ]).merge();
            // Mark the directory as changed for gallery rebuild tasks further down:
            directoryAccumulator.add(path.dirname(entry.path));
            log.debug({ path: entry.path }, 'Imported file into gallery module');
        } catch (err) {
            log.error({ err, path: entry.path }, 'Failed to process image for gallery import');
            return;
        }
    }, { concurrency: CONCURRENCY });
}

async function removeDeletedImages(import_id: string, tree_id: number, trx: Knex, directoryAccumulator: Set<string>) {
    const entries = await trx('removed')
        .withSchema(CORE)
        .select('path')
        .where({
            tree_id: tree_id,
            removed_at: import_id,
        })
        .whereIn('ext1', SUPPORTED_EXTENSIONS);
    for (const entry of entries) {
        await trx('images')
            .withSchema(GALLERY)
            .where({
                tree_id: tree_id,
                path: entry.path
            })
            .delete();
        directoryAccumulator.add(path.dirname(entry.path));
    }
}

async function importGalleryConfigs(import_id: string, tree_id: number, trx: Knex, directoryAccumulator: Set<string>) {
    const modifiedRcFiles = await trx('entries')
        .withSchema(CORE)
        .select('path')
        .where({
            tree_id: tree_id,
            ext1: '.galleryrc',
            last_change_at: import_id
        });
    for (const rcFileEntry of modifiedRcFiles) {
        let rc;
        try {
            const fileContents = await fs.readFile(rcFileEntry.path, 'utf-8');
            rc = GalleryRc.parse(JSON.parse(fileContents));
        } catch (err) {
            log.error({ err, path: rcFileEntry.path }, 'Failed to load .galleryrc file');
            continue;
        }
        const rootPath = path.dirname(rcFileEntry.path);
        const newConfig = {
            tree_id: tree_id,
            root_path: rootPath,
            name: rc.name ?? path.basename(rootPath),
            description: rc.description ?? null,
        };
        const [{ gallery_id }] = await trx('galleries')
            .withSchema(GALLERY)
            .insert(newConfig).onConflict('root_path').merge()
            .returning('gallery_id');
        await trx('access')
            .withSchema(GALLERY)
            .where({ gallery_id })
            .delete();
        if (rc.accounts.length > 0) {
            await trx('access')
                .withSchema(GALLERY)
                .insert(rc.accounts.map((account) => ({ gallery_id, account })));
        }
        // Mark this gallery as needing rebuild:
        directoryAccumulator.add(rootPath);
    }
}

async function rebuildPictureSequences(import_id: string, tree_id: number, trx: Knex, directoriesNeedingRebuild: Set<string>) {
    for (const root_path of directoriesNeedingRebuild) {
        const galleryRow = await trx('galleries')
            .withSchema(GALLERY)
            .where({ root_path })
            .first();
        if (!galleryRow) {
            // This directory isn't a gallery, so we don't need to process anything.
            continue;
        }
        const { gallery_id } = galleryRow;
        await trx('items').withSchema(GALLERY).where({ gallery_id }).delete();
        await trx.raw(`INSERT INTO gallery.items (
            gallery_id, seq, image_id
        ) SELECT
            ?, ROW_NUMBER() OVER (ORDER BY taken_at), image_id
        FROM
            gallery.images
        WHERE
            tree_id = ? AND path LIKE ?`, [
                gallery_id,
                tree_id,
                // TODO: Sanitize '%'
                `${root_path}/%`
        ]);
        log.info({ gallery_id, root_path }, 'Gallery re-indexed');
    }
}

async function generateAllMissingThumbnails(trx: Knex) {
    let generatedCount = 0;
    for (const [ variantNumber, variant ] of THUMBNAIL_VARIANTS.entries()) {
        // Find all images that lack this thumbnail variant:
        const imagesThatNeedThumbnail: Array<{
            path: string,
            sha256: Buffer
        }> = await trx.select(trx.raw(`
            images.path, images.sha256
        FROM
            gallery.items
        LEFT JOIN
            gallery.images ON (items.image_id = images.image_id)
        LEFT JOIN
            gallery.thumbnails ON (images.sha256 = thumbnails.orig_sha256 AND thumbnails.variant = ?)
        WHERE
            images.path IS NOT NULL AND
            thumbnails.thumb_path IS NULL`, [
            variantNumber
        ]));
        // NOTE: This is a good place for streams, too.
        for (const { path: filePath, sha256: fileHash } of imagesThatNeedThumbnail) {
            try {
                const thumbnailFilename = `${fileHash.toString('hex')}-v${variantNumber}-${variant.w}x${variant.h}.jpg`;
                const thumbnailPath = path.join(GALLERY_THUMBNAIL_PATH, thumbnailFilename);
                const resizeInfo = await sharp(filePath).resize({
                    width: variant.w,
                    height: variant.h,
                    fit: sharp.fit.inside
                }).jpeg({ quality: variant.quality }).toFile(thumbnailPath);
                await trx('thumbnails')
                    .withSchema(GALLERY)
                    .insert({
                        orig_sha256: fileHash,
                        variant: variantNumber,
                        thumb_path: thumbnailPath,
                        thumb_w: resizeInfo.width,
                        thumb_h: resizeInfo.height,
                    });
                generatedCount++;
            } catch (err) {
                log.error({ path: filePath, variantNumber, err }, 'Failed to generate thumbnail for image')
            }
        }
    }
    if (generatedCount > 0) {
        log.info({ generatedCount }, 'Generated thumbnails');
    }
}

const handleImport: MessageHandler = async (msg, trx) => {
    try {
        const payload = JSON.parse(msg.payload.toString('utf-8'));
        const { import_id, tree_id } = ImportFinished.parse(payload);
        const directoriesWithChanges = new Set<string>();
        await importImages(import_id, tree_id, trx, directoriesWithChanges);
        await removeDeletedImages(import_id, tree_id, trx, directoriesWithChanges);
        await importGalleryConfigs(import_id, tree_id, trx, directoriesWithChanges);
        // TODO: Delete old galleries if .galleryrc is gone.
        await rebuildPictureSequences(import_id, tree_id, trx, directoriesWithChanges);
        await generateAllMissingThumbnails(trx);
        // TODO: Clean up orphaned thumbnails.
    } catch (error) {
        // HACK: Make debugging easier instead of spinning on the message.
        console.error(error);
        process.exit(1);
    }

};

export async function start(builder: ConsumerBuilder) {
    const consumer = builder.handler(handleImport).build();
    await consumer.run();
}
