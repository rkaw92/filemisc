import { knex } from "knex";
import { Admin, ConsumerBuilder } from "pgstream";
import { start } from "../apps/gallery/gallery";
import { env } from "../utils/env";

const db = knex({
    client: 'pg',
    connection: env('POSTGRES_URL'),
    pool: { min: 1, max: 4 }
});

(async function() {
    const admin = new Admin(db);
    await admin.install();
    await admin.createStream('ImportFinished');

    const consumerBuilder = new ConsumerBuilder()
        .withKnex(db)
        .stream('ImportFinished')
        .name('gallery');
    await start(consumerBuilder);
})();
