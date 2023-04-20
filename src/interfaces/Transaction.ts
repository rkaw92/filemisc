import { Queryable } from "./Queryable";

export interface Transaction extends Queryable {
    onCommit(commitCallback: () => void): void;
}
