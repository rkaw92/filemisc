import { Writable } from "node:stream";
import { Transaction } from "./Transaction";

export interface TransactionWithCopy extends Transaction {
    copyFrom(text: string): Writable;
}
