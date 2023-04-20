import { FilesystemEntry } from './types/FilesystemEntry';
import { Dir, Dirent } from 'fs';
import { opendir, lstat } from 'fs/promises';
import { join as pathJoin } from 'path';

async function direntToFilesystemEntry(dirent: Dirent, parentPath: string): Promise<FilesystemEntry> {
  const fullPath = pathJoin(parentPath, dirent.name);
  const stats = await lstat(fullPath);
  return {
    path: fullPath,
    bytes: stats.size,
    type: dirent.isFile() ? 'file' : dirent.isDirectory() ? 'directory' : dirent.isSymbolicLink() ? 'link' : 'other',
    mtime: stats.mtime.getTime()
  };
}

/**
 * Traverse a directory recursively to produce an iterable of Filesystem Entries.
 * @param path The path to the directory to recurse into.
 * @param errorReporter - An optional function to catch errors, such as access denials or when files move around.
 */
export async function *traverse(
  path: string,
  errorReporter: (err: any) => void = () => {}
): AsyncGenerator<FilesystemEntry> {
  let currentDir = await opendir(path);
  for await (const rawEntry of currentDir) {
    try {
      const entry = await direntToFilesystemEntry(rawEntry, path);
      yield entry;
      if (entry.type === 'directory') {
        for await (const processedEntry of traverse(entry.path)) {
          yield processedEntry;
        }
      }
    } catch (error) {
      errorReporter(error);
    }
  }
}
