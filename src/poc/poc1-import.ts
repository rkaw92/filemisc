import { Pool } from "pg";
import pino from "pino";
import { importFiles } from "../core/importFiles";
import { TransactionalOutbox } from "../core/TransactionalOutbox";
import { traverse } from "../traverse";
import { env } from "../utils/env";
import { borrow } from "../utils/pg";

const pool = new Pool({
    connectionString: env('POSTGRES_URL')
});
const logger = pino({ level: env('LOG_LEVEL', 'debug') });
const sourceDirectory = env('IMPORT_PATH');

(async function() {
    await borrow(pool, async (provider) => {
        const fileSource = traverse(sourceDirectory);
        const outbox = new TransactionalOutbox(async (event) => {
            console.log('-> FAKE PUBLISH: %j', event);
        }, provider);
        await outbox.recover();
        await importFiles(provider, fileSource, logger, outbox);
    });
})();
