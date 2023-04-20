import { Transaction } from "./Transaction";

export interface TransactionProvider {
    transaction<TResolve>(func: (trx: Transaction) => Promise<TResolve>): Promise<TResolve>;
}
