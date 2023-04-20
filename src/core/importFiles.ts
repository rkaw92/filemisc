import { FilesystemEntry } from "../types/FilesystemEntry";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Logger } from "pino";
import { TransactionalOutbox } from "./TransactionalOutbox";
import { TransactionProviderWithCopy } from "../interfaces/TransactionProviderWithCopy";

export async function importFiles(
    db: TransactionProviderWithCopy,
    source: AsyncIterable<FilesystemEntry>,
    parentLogger: Logger,
    outbox: TransactionalOutbox
) {
    const importID = await db.transaction(async (trx) => {
        const importStart = await trx.query<{ import_id: string }>('INSERT INTO imports (import_id) VALUES (DEFAULT) RETURNING import_id', []);
        const importID: string = importStart.rows[0]!.import_id;
        return importID;
    });
    const logger = parentLogger.child({ importID });
    logger.info('Import process started');
    await db.transaction(async (trx) => {
        // Copy all received files into a temporary table:
        const importTableName = `import_${importID}`;
        await trx.query(`CREATE TEMPORARY TABLE ${importTableName} (LIKE entries INCLUDING ALL) ON COMMIT DROP`, []);
        logger.debug({ importTableName }, 'Created transaction-local temp table');
        const writable = trx.copyFrom(`COPY ${importTableName} (path, type, bytes, mtime, first_discovery_at, last_change_at) FROM STDIN`);
        const toTSV = new Transform({
            writableObjectMode: true,
            readableObjectMode: false,
            transform(entry: FilesystemEntry, _encoding, callback) {
                callback(null, `${entry.path}\t${entry.type}\t${entry.bytes}\t${new Date(entry.mtime).toISOString()}\t${importID}\t${importID}\n`);
            }
        });
        await pipeline(source, toTSV, writable);
        logger.debug('Finished COPY FROM STDIN');
        // Run change detection based on last-modified time (mtime):
        await trx.query(`MERGE INTO entries AS target
            USING ${importTableName} AS input
            ON (input.path = target.path)
            WHEN NOT MATCHED THEN INSERT (path, type, bytes, mtime, first_discovery_at, last_change_at)
                VALUES (input.path, input.type, input.bytes, input.mtime, input.first_discovery_at, input.last_change_at)
            WHEN MATCHED AND (input.mtime <> target.mtime) THEN UPDATE
                SET mtime = input.mtime, bytes = input.bytes, last_change_at = input.last_change_at
            WHEN MATCHED THEN DO NOTHING
        `, []);
        logger.debug('Finished MERGE');
        // Remove old files which are not in the newest import:
        const removal = await trx.query(`DELETE FROM entries
            WHERE
                NOT EXISTS (SELECT FROM ${importTableName} import WHERE import.path = entries.path)`, []);
        logger.debug('Finished DELETE');
        const deletedCount = removal.rowCount;
        // Update import stats:
        // TODO: Make this faster - all these COUNT(*)s are probably slow.
        await trx.query(`UPDATE imports
            SET
                finished_at = $1,
                entry_count = (SELECT COUNT(*) FROM ${importTableName}),
                new_count = (SELECT COUNT(*) FROM entries WHERE first_discovery_at = $2),
                changed_count = (SELECT COUNT(*) FROM entries WHERE first_discovery_at <> $3 AND last_change_at = $4),
                deleted_count = $5
            WHERE import_id = $6`, [
                    new Date(),
                    importID,
                    importID,
                    importID,
                    deletedCount,
                    importID
                ]);
        await outbox.publish({
            id: `${importID}_done`,
            name: 'ImportFinished',
            payload: { importID }
        }, trx);
    });
    logger.info('Import finished');
}
