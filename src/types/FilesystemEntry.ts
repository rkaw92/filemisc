export interface FilesystemEntry {
    path: string;
    type: "file" | "directory" | "link" | "other";
    bytes: number;
    mtime: number;
};
