import { FilesystemEntry } from "../types/FilesystemEntry";
import { pipeline } from "node:stream/promises";
import { Logger } from "pino";
import { TransactionalOutbox } from "./TransactionalOutbox";
import { TransactionProviderWithCopy } from "../interfaces/TransactionProviderWithCopy";
import { entriesToTSV } from "./entriesToTSV";

export async function importFiles(
    db: TransactionProviderWithCopy,
    treeID: number,
    source: AsyncIterable<FilesystemEntry>,
    parentLogger: Logger,
    outbox: TransactionalOutbox
) {
    // Mark import start:
    const importID = await db.transaction(async (trx) => {
        const importStart = await trx.query<{ import_id: string }>('INSERT INTO imports (import_id, tree_id) VALUES (DEFAULT, $1) RETURNING import_id', [ treeID ]);
        const importID: string = importStart.rows[0]!.import_id;
        return importID;
    });
    const logger = parentLogger.child({ importID });
    logger.info('Import process started');
    // Process file entries from the source:
    await db.transaction(async (trx) => {
        // First, make sure the table leaf for the given tree_id exists:
        await trx.query(`CREATE TABLE IF NOT EXISTS entries_${treeID} PARTITION OF entries FOR VALUES IN (${treeID})`, []);
        // Copy all received files into a temporary table:
        const importTableName = `import_${importID}`;
        await trx.query(`CREATE TEMPORARY TABLE ${importTableName} (LIKE entries INCLUDING ALL) ON COMMIT DROP`, []);
        logger.debug({ importTableName }, 'Created transaction-local temp table');
        const writable = trx.copyFrom(`COPY ${importTableName} (tree_id, path, type, bytes, mtime, first_discovery_at, last_change_at) FROM STDIN`);
        await pipeline(source, entriesToTSV(treeID, importID), writable);
        logger.debug('Finished COPY FROM STDIN');
        // Run change detection based on last-modified time (mtime):
        await trx.query(`MERGE INTO entries AS target
            USING ${importTableName} AS input
            ON (input.tree_id = target.tree_id AND input.path = target.path)
            WHEN NOT MATCHED THEN INSERT (tree_id, path, type, bytes, mtime, first_discovery_at, last_change_at)
                VALUES (input.tree_id, input.path, input.type, input.bytes, input.mtime, input.first_discovery_at, input.last_change_at)
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
        // Gather affected object counts:
        const entryCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM ${importTableName}`, [])).rows[0]!.c);
        const newCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM entries WHERE first_discovery_at = $1`, [ importID ])).rows[0]!.c);
        const changedCount = Number((await trx.query(`SELECT COUNT(*) AS c FROM entries WHERE first_discovery_at <> $1 AND last_change_at = $2`, [ importID, importID ])).rows[0]!.c);
        const deletedCount = removal.rowCount;
        // Update import stats:
        // TODO: Make this faster - all these COUNT(*)s are probably slow.
        await trx.query(`UPDATE imports
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
                    importID
                ]);
        // Check if the import was meaningful, or if nothing changed.
        if (newCount > 0 || changedCount > 0 || deletedCount > 0) {
            await outbox.publish({
                id: `${importID}_done`,
                name: 'ImportFinished',
                payload: { importID, treeID, entryCount, newCount, changedCount, deletedCount }
            }, trx);
        } else {
            await trx.query('DELETE FROM imports WHERE import_id = $1', [ importID ]);
        }
    });
    logger.info('Import finished');
}
