import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type PublishedChange = { readonly branch: string; readonly base: string; readonly files: Readonly<Record<string, string>>; readonly message: string };

export interface ProjectFiles {
  read(path: string): Promise<string | undefined>;
  list(folder: string): Promise<readonly string[]>;
}

export const createProjectFiles = (root: string): ProjectFiles => ({
  read: (path) => readFile(join(root, path), 'utf8').catch(() => undefined),
  list: async (folder) => (await readdir(join(root, folder)).catch(() => [])).toSorted(),
});

export const createInMemoryProjectFiles = (files: Readonly<Record<string, string>>): ProjectFiles => ({
  read: async (path) => files[path],
  list: async (folder) =>
    [...new Set(Object.keys(files).flatMap((path) => (path.startsWith(`${folder}/`) ? [path.slice(folder.length + 1).split('/', 1).join('')] : [])))].toSorted(),
});
