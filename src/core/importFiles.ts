import { FilesystemEntry } from "../types/FilesystemEntry";
import { pipeline } from "node:stream/promises";
import { Logger } from "pino";
import { TransactionalOutbox } from "./TransactionalOutbox";
import { TransactionProviderWithCopy } from "../interfaces/TransactionProviderWithCopy";
import { entriesToTSV } from "./entriesToTSV";
import { ImportFinished } from "../events/ImportFinished";
import { z } from 'zod';

export async function importFiles(
    db: TransactionProviderWithCopy,
    tree_id: number,
    source: AsyncIterable<FilesystemEntry>,
    parentLogger: Logger,
    outbox: TransactionalOutbox
) {
    // Mark import start:
    const import_id = await db.transaction(async (trx) => {
        const importStart = await trx.query<{ import_id: string }>('INSERT INTO core.imports (import_id, tree_id) VALUES (DEFAULT, $1) RETURNING import_id', [ tree_id ]);
        const importID: string = importStart.rows[0]!.import_id;
        return importID;
    });
    const logger = parentLogger.child({ import_id: import_id });
    logger.info('Import process started');
    // Process file entries from the source:
    await db.transaction(async (trx) => {
        // First, make sure the table leaf for the given tree_id exists:
        await trx.query(`CREATE TABLE IF NOT EXISTS core.entries_${tree_id} PARTITION OF core.entries FOR VALUES IN (${tree_id})`, []);
        await trx.query(`CREATE TABLE IF NOT EXISTS core.removed_${tree_id} PARTITION OF core.removed FOR VALUES IN (${tree_id})`, []);
        // Copy all received files into a temporary table:
        const importTableName = `import_${import_id}`;
        await trx.query(`CREATE TEMPORARY TABLE ${importTableName} (LIKE core.entries INCLUDING ALL) ON COMMIT DROP`, []);
        logger.debug({ importTableName }, 'Created transaction-local temp table');
        const writable = trx.copyFrom(`COPY ${importTableName} (tree_id, path, ext1, type, bytes, mtime, first_discovery_at, last_change_at) FROM STDIN`);
        await pipeline(source, entriesToTSV(tree_id, import_id), writable);
        logger.debug('Finished COPY FROM STDIN');
        // Run change detection based on last-modified time (mtime):
        await trx.query(`MERGE INTO core.entries AS target
            USING ${importTableName} AS input
            ON (input.tree_id = target.tree_id AND input.path = target.path)
            WHEN NOT MATCHED THEN INSERT (tree_id, path, ext1, type, bytes, mtime, first_discovery_at, last_change_at)
                VALUES (input.tree_id, input.path, input.ext1, input.type, input.bytes, input.mtime, input.first_discovery_at, input.last_change_at)
            WHEN MATCHED AND (input.mtime <> target.mtime) THEN UPDATE
                SET mtime = input.mtime, bytes = input.bytes, last_change_at = input.last_change_at
            WHEN MATCHED THEN DO NOTHING
        `, []);
        logger.debug('Finished MERGE');
        // Remove old files which are not in the newest import:
        await trx.query(`INSERT INTO core.removed (tree_id, path, ext1, removed_at)
        SELECT tree_id, path, ext1, $1 FROM core.entries
        WHERE
            tree_id = $2
            AND NOT EXISTS (SELECT FROM ${importTableName} import WHERE import.path = entries.path)`, [
                import_id,
                tree_id
            ]);
        const removal = await trx.query(`DELETE FROM core.entries
            WHERE
                tree_id = $1
                AND NOT EXISTS (SELECT FROM ${importTableName} import WHERE import.path = entries.path)`, [
                    tree_id
                ]);
        logger.debug('Finished DELETE');
        // Gather affected object counts:
        const entryCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM ${importTableName}`, [])).rows[0]!.c);
        const newCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM core.entries WHERE first_discovery_at = $1`, [ import_id ])).rows[0]!.c);
        const changedCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM core.entries WHERE first_discovery_at <> $1 AND last_change_at = $2`, [ import_id, import_id ])).rows[0]!.c);
        const deletedCount = removal.rowCount;
        // Update import stats:
        // TODO: Make this faster - all these COUNT(*)s are probably slow.
        await trx.query(`UPDATE core.imports
            SET
                finished_at = $1,
                entry_count = $2,
                new_count = $3,
                changed_count = $4,
                deleted_count = $5
            WHERE import_id = $6`, [
                    new Date(),
                    entryCount,
                    newCount,
                    changedCount,
                    deletedCount,
                    import_id
                ]);
        // Check if the import was meaningful, or if nothing changed.
        if (newCount > 0 || changedCount > 0 || deletedCount > 0) {
            const payload: z.infer<typeof ImportFinished> = { import_id, tree_id, entryCount, newCount, changedCount, deletedCount };
            await outbox.publish({
                id: `${import_id}_done`,
                name: 'ImportFinished',
                payload: payload
            }, trx);
        } else {
            await trx.query('DELETE FROM core.imports WHERE import_id = $1', [ import_id ]);
        }
    });
    logger.info('Import finished');
}
