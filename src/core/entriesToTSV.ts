import { Transform } from "node:stream";
import { FilesystemEntry } from "../types/FilesystemEntry";

export function entriesToTSV(treeID: number, importID: string) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: false,
        transform(entry: FilesystemEntry, _encoding, callback) {
        callback(null, `${treeID}\t${entry.path}\t${entry.type}\t${entry.bytes}\t${new Date(entry.mtime).toISOString()}\t${importID}\t${importID}\n`);
        }
    });
}
