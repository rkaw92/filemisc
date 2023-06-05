import { Transform } from "node:stream";
import { FilesystemEntry } from "../types/FilesystemEntry";

export function entriesToTSV(importID: string) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: false,
        transform(entry: FilesystemEntry, _encoding, callback) {
            callback(null, `${entry.path}\t${entry.type}\t${entry.bytes}\t${new Date(entry.mtime).toISOString()}\t${importID}\t${importID}\n`);
        }
    });
}
