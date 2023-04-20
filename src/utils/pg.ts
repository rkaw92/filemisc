import { PoolClient, Pool, QueryResultRow } from "pg";
import { from as copyFromStream } from "pg-copy-streams";
import { Writable } from "stream";
import { TransactionProviderWithCopy } from "../interfaces/TransactionProviderWithCopy";
import { TransactionWithCopy } from "../interfaces/TransactionWithCopy";

class PgTransaction implements TransactionWithCopy {
    private commitCallbacks: Set<() => void> = new Set();
    constructor(private client: PoolClient) {}
    query<ResultType extends QueryResultRow>(query: string, placeholders: any[]) {
        return this.client.query<ResultType>(query, placeholders);
    }
    copyFrom(text: string): Writable {
        return this.client.query(copyFromStream(text));
    }
    onCommit(callback: () => void): void {
        this.commitCallbacks.add(callback);
    }
    committed(): void {
        setImmediate(() => {
            for (let callback of this.commitCallbacks) {
                callback();
            }
        });
    }
}

class PgTransactionProvider implements TransactionProviderWithCopy {
    constructor(private client: PoolClient) {}
    async transaction<TResolve>(func: (trx: TransactionWithCopy) => Promise<TResolve>): Promise<TResolve> {
        await this.client.query('BEGIN');
        let transactionValue: TResolve;
        const transactionHandle = new PgTransaction(this.client);
        try {
            transactionValue = await func(transactionHandle);
        } catch (error) {
            this.client.query('ROLLBACK');
            throw error;
        }
        await this.client.query('COMMIT');
        transactionHandle.committed();
        return transactionValue;
    }
}

export async function borrow<TReturn>(
    pool: Pool,
    clientFunction: (provider: TransactionProviderWithCopy) => Promise<TReturn>
): Promise<TReturn> {
    const client = await pool.connect();
    const provider = new PgTransactionProvider(client);
    try {
        return await clientFunction(provider);
    } finally {
        client.release();
    }
}
