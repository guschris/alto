import * as fs from 'fs';
import * as path from 'path';

/**
 * Lists files and directories in a given path, optionally recursively.
 * @param dirPath The directory path relative to the current working directory.
 * @param recursive If true, lists files recursively in subdirectories.
 * @returns An array of file paths relative to the current working directory.
 */
export function list_files(dirPath: string, recursive: boolean = false): string[] {
    let files: string[] = [];
    const absoluteDirPath = path.resolve(process.cwd(), dirPath);

    try {
        const dirents = fs.readdirSync(absoluteDirPath, { withFileTypes: true });

        for (const dirent of dirents) {
            const res = path.resolve(absoluteDirPath, dirent.name);
            const relativeRes = path.relative(process.cwd(), res);

            if (dirent.isDirectory()) {
                if (recursive) {
                    files = files.concat(list_files(relativeRes, true));
                }
            } else {
                files.push(relativeRes);
            }
        }
    } catch (error: any) {
        // If the directory does not exist or is not accessible, return an empty array
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            return [];
        }
        throw error;
    }

    return files;
}
