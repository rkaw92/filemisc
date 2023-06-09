import { basename, extname } from "node:path";
import { Transform } from "node:stream";
import { FilesystemEntry } from "../types/FilesystemEntry";

export function entriesToTSV(treeID: number, importID: string) {
    return new Transform({
        writableObjectMode: true,
        readableObjectMode: false,
        transform(entry: FilesystemEntry, _encoding, callback) {
            const ext1 = (extname(entry.path) || basename(entry.path)).toLowerCase();
            callback(null, `${treeID}\t${entry.path}\t${ext1}\t${entry.type}\t${entry.bytes}\t${new Date(entry.mtime).toISOString()}\t${importID}\t${importID}\n`);
        }
    });
}
