import { Transaction } from "../interfaces/Transaction";
import { TransactionProvider } from "../interfaces/TransactionProvider";
import { Event } from "../types/Event";
import { retry } from "../utils/retry";

export class TransactionalOutbox {
    constructor(
        private publisher: (event: Event) => Promise<void>,
        private background: TransactionProvider
    ) {}

    async publish(event: Event, currentTransaction: Transaction) {
        await currentTransaction.query('INSERT INTO outbox (id, name, payload) VALUES ($1, $2, $3)', [
            event.id,
            event.name,
            JSON.stringify(event.payload)
        ]);
        currentTransaction.onCommit(() => {
            retry(async () => {
                await this.background.transaction(async (trx) => {
                    const lock = await trx.query('SELECT id FROM outbox WHERE id = $1 FOR UPDATE', [ event.id ]);
                    if (lock.rows.length > 0) {
                        await this.publisher(event);
                        await trx.query('DELETE FROM outbox WHERE id = $1', [ event.id ]);
                    }
                });
            });
            // TODO: Error logging.
        });
    }

    async recover() {
        await this.background.transaction(async (trx) => {
            const limit = 100;
            let processed: number;
            do {
                const remainingInbox = await trx.query<Event>('SELECT id, name, payload FROM outbox LIMIT $1 FOR UPDATE SKIP LOCKED', [ limit ]);
                processed = 0;
                for (const event of remainingInbox.rows) {
                    await this.publisher(event);
                    await trx.query('DELETE FROM outbox WHERE id = $1', [ event.id ]);
                    processed++;
                }
            } while (processed > 0);
        });
    }
}
