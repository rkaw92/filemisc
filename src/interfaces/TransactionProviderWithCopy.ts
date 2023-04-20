import { TransactionProvider } from "./TransactionProvider";
import { TransactionWithCopy } from "./TransactionWithCopy";

export interface TransactionProviderWithCopy extends TransactionProvider {
    transaction<TResolve>(func: (trx: TransactionWithCopy) => Promise<TResolve>): Promise<TResolve>;
}
