import { Pool } from "pg";
import knex from "knex";
import pino from "pino";
import { importFiles } from "../core/importFiles";
import { TransactionalOutbox } from "../core/TransactionalOutbox";
import { traverse } from "../traverse";
import { env } from "../utils/env";
import { borrow } from "../utils/pg";
import { Admin, ProducerBuilder } from 'pgstream';
import { PendingMessage } from "pgstream/dist/PendingMessage";

const importPool = new Pool({
    connectionString: env('POSTGRES_URL'),
    min: 1,
    max: 2
});
const messagingDb = knex({
    client: 'pg',
    connection: env('POSTGRES_URL'),
    pool: { min: 1, max: 2 }
});
const logger = pino({ level: env('LOG_LEVEL', 'debug') });
const sourceDirectory = env('IMPORT_PATH');

(async function() {
    const admin = new Admin(messagingDb);
    await admin.install();
    await admin.createStream('ImportFinished');
    const producer = new ProducerBuilder().withKnex(messagingDb).stream('ImportFinished').build();
    await borrow(importPool, async (provider) => {
        const fileSource = traverse(sourceDirectory);
        const importOutbox = new TransactionalOutbox(async (event) => {
            await producer.produce(
                new PendingMessage(Buffer.from(JSON.stringify(event.payload)))
            );
        }, provider);
        await importOutbox.recover();
        await importFiles(provider, 1, fileSource, logger, importOutbox);
    });
})();
