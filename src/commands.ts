import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as fsp from 'fs/promises'; // Import fs.promises
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';

const commandNames = [ 'list_files', 'read_file', 'write_file', 'search_files', 'list_code_definitions', 'execute_command', 'replace_in_file' ];

const languageDefinitions: { [key: string]: { type: string, regex: RegExp }[] } = {
    '.js': [
        { type: 'class', regex: /(?:class|export class)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'function', regex: /(?:function|export function)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/ },
        { type: 'arrow function', regex: /(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*\(.*\)\s*=>/ },
    ],
    '.ts': [
        { type: 'class', regex: /(?:class|export class)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'function', regex: /(?:function|export function)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/ },
        { type: 'arrow function', regex: /(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*\(.*\)\s*=>/ },
    ],
    '.jsx': [
        { type: 'class', regex: /(?:class|export class)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'function', regex: /(?:function|export function)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/ },
        { type: 'arrow function', regex: /(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*\(.*\)\s*=>/ },
    ],
    '.tsx': [
        { type: 'class', regex: /(?:class|export class)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'function', regex: /(?:function|export function)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/ },
        { type: 'arrow function', regex: /(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*\(.*\)\s*=>/ },
    ],
    '.py': [
        { type: 'function', regex: /def\s+([a-zA-Z_][0-9a-zA-Z_]*)\s*\(.*?\):/ },
        { type: 'class', regex: /class\s+([a-zA-Z_][0-9a-zA-Z_]*)(?:\(.*?\))?:/ },
    ],
    '.go': [
        { type: 'function', regex: /func\s+(?:\([a-zA-Z_][0-9a-zA-Z_]*\s+[a-zA-Z_][0-9a-zA-Z_]*\)\s+)?([a-zA-Z_][0-9a-zA-Z_]*)\s*\(.*?\)\s*(?:[a-zA-Z_][0-9a-zA-Z_]*\s*)?{/ },
        { type: 'struct', regex: /type\s+([a-zA-Z_][0-9a-zA-Z_]*)\s+struct\s*{/ },
    ],
    '.java': [
        { type: 'class', regex: /(?:public|private|protected)?\s*(?:static\s+)?class\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'interface', regex: /(?:public|private|protected)?\s*interface\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/ },
        { type: 'method', regex: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:<[a-zA-Z_$][0-9a-zA-Z_$]*>)?\s*[a-zA-Z_$][0-9a-zA-Z_$]*\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(.*?\)/ },
    ],
    '.cs': [
        { type: 'class', regex: /(?:public|private|protected|internal)?\s*(?:static\s+)?class\s+([a-zA-Z_][0-9a-zA-Z_]*)/ },
        { type: 'interface', regex: /(?:public|private|protected|internal)?\s*interface\s+([a-zA-Z_][0-9a-zA-Z_]*)/ },
        { type: 'method', regex: /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:virtual\s+)?(?:abstract\s+)?(?:override\s+)?(?:async\s+)?(?:<[a-zA-Z_][0-9a-zA-Z_]*>)?\s*[a-zA-Z_][0-9a-zA-Z_]*\s+([a-zA-Z_][0-9a-zA-Z_]*)\s*\(.*?\)/ },
    ],
    '.zig': [
        { type: 'function', regex: /fn\s+([a-zA-Z_][0-9a-zA-Z_]*)\s*\(.*?\)\s*/ },
        { type: 'struct', regex: /pub\s+const\s+([a-zA-Z_][0-9a-zA-Z_]*)\s*=\s*struct\s*{/ },
    ],
    '.rs': [
        { type: 'function', regex: /fn\s+([a-zA-Z_][0-9a-zA-Z_]*)\s*\(.*?\)\s*(?:->\s*.*?)?\s*{/ },
        { type: 'struct', regex: /struct\s+([a-zA-Z_][0-9a-zA-Z_]*)(?:\s*<.*?>)?\s*{/ },
        { type: 'enum', regex: /enum\s+([a-zA-Z_][0-9a-zA-Z_]*)(?:\s*<.*?>)?\s*{/ },
        { type: 'trait', regex: /trait\s+([a-zA-Z_][0-9a-zA-Z_]*)(?:\s*<.*?>)?\s*{/ },
        { type: 'impl for', regex: /impl(?:\s*<.*?>)?\s*(?:[a-zA-Z_][0-9a-zA-Z_]*)?\s*for\s+([a-zA-Z_][0-9a-zA-Z_]*)(?:\s*<.*?>)?\s*{/ },
    ],
};

export function extractCommand(response: string): string|null {
    const startTagMatcher = new RegExp(`^<(${commandNames.join('|')})>$`, "m") // multiline search, matches whole lines only
    const matches = startTagMatcher.exec(response);
    if (matches == null) return null;
    const startIndex = matches.index;
    const command = matches[1]; // 0 = if the matched test, 1 = the subgroup
    const endTag = `</${command}>`;
    const endTagIndex = response.indexOf(endTag, startIndex + matches[0].length);
    if (endTagIndex < 0) return null;
    const endIndex = endTagIndex + endTag.length;
    const commandXml = response.slice(startIndex, endIndex + 1);
    return commandXml;
}

export async function runCommand(commandXml: string): Promise<string> {
    const parser = new XMLParser({ ignoreAttributes: true });
    const obj = parser.parse(commandXml);

    if (obj.list_files) {
        return await list_files(obj.list_files.path, obj.list_files.recursive);
    } else if (obj.read_file) {
        return read_file(obj.read_file.path);
    } else if (obj.write_file) {
        return write_file(obj.write_file.path, obj.write_file.content);
    } else if (obj.execute_command) {
        return await execute_command(obj.execute_command.command, obj.execute_command.safe);
    } else if (obj.search_files) {
        return search_files(obj.search_files.path, obj.search_files.regex, obj.search_files.recursive);
    } else if (obj.list_code_definitions) {
        return list_code_definitions(obj.list_code_definitions.path, obj.list_code_definitions.recursive);
    } else if (obj.replace_in_file) {
        return replace_in_file(obj.replace_in_file.path, obj.replace_in_file.regex, obj.replace_in_file.substitution);
    } else {
        return `ERROR: unknown tool`;
    }
}

/**
 * Lists files and directories in a given path, optionally recursively.
 * @param dirPath The directory path relative to the current working directory.
 * @param recursive If true, lists files recursively in subdirectories.
 * @returns An array of file paths relative to the current working directory.
 */
async function list_files(dirPath: string, recursive: boolean = false): Promise<string> {
    let files: string[] = [];
    const absoluteDirPath = path.resolve(process.cwd(), dirPath);
    const ignorePatterns = getGitIgnorePatterns(absoluteDirPath);

    try {
        const dirents = await fsp.readdir(absoluteDirPath, { withFileTypes: true });

        for (const dirent of dirents) {
            const fullPath = path.resolve(absoluteDirPath, dirent.name);
            const relativePath = path.relative(process.cwd(), fullPath);

            if (shouldIgnoreEntry(dirent, ignorePatterns)) {
                continue;
            }

            if (dirent.isDirectory()) {
                if (recursive) {
                    const subFiles = await list_files(relativePath, true);
                    if (subFiles !== '(no files)' && !subFiles.startsWith('ERROR:')) {
                        files = files.concat(subFiles.split('\n'));
                    }
                }
            } else {
                files.push(relativePath);
            }
        }
    } catch (error: any) {
        // If the directory does not exist or is not accessible, return an empty array
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            return '(no files)';
        }
        throw error;
    }

    return files.join('\n');
}


function shouldIgnoreEntry(dirent: fs.Dirent, ignorePatterns: string[]): boolean {
    return ignorePatterns.some((pattern: string) => {
        if (dirent.isDirectory()) {
            return pattern === dirent.name || (pattern.endsWith('/') && pattern.slice(0, -1) === dirent.name);
        } else if (dirent.isFile()) {
            return pattern === dirent.name;
        }
        return false;
    });
}

function read_file(filePath: string): string {
    try {
        const absolutePath = path.resolve(process.cwd(), filePath);
        return fs.readFileSync(absolutePath, 'utf-8');
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return `ERROR: File not found at ${filePath}`;
        }
        return `ERROR: Could not read file ${filePath}: ${error.message}`;
    }
}

function write_file(filePath: string, content: string): string {
    try {
        const absolutePath = path.resolve(process.cwd(), filePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content, 'utf-8');
        return `File written successfully to ${filePath}`;
    } catch (error: any) {
        return `ERROR: Could not write file ${filePath}: ${error.message}`;
    }
}

const execPromise = util.promisify(exec);

async function execute_command(command: string, safe: boolean): Promise<string> {
    if (!safe) {
        return "ERROR: Cannot execute command. 'unsafe' parameter is false.";
    }
    try {
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            console.error("command returned: " + stderr);
        }
        return stdout;
    } catch (error: any) {
        return `ERROR: Command failed: ${error.message}\n${error.stderr}`;
    }
}

function getGitIgnorePatterns(dirPath: string): string[] {
    const gitignorePath = path.join(dirPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        return content.split('\n')
                      .map(line => line.trim())
                      .filter(line => line.length > 0 && !line.startsWith('#'))
                      .concat('..');
    }
    return ['..'];
}

async function search_files(dirPath: string, regex: string, recursive: boolean = false): Promise<string> {
    if (!regex) return "ERROR: no rexexp provided";
    let results: string[] = [];
    const absoluteDirPath = path.resolve(process.cwd(), dirPath);
    const searchRegex = new RegExp(regex, 'g');

    const ignorePatterns = getGitIgnorePatterns(absoluteDirPath);

    try {
        const dirents = await fsp.readdir(absoluteDirPath, { withFileTypes: true });

        for (const dirent of dirents) {
            const fullPath = path.resolve(absoluteDirPath, dirent.name);
            const relativePath = path.relative(process.cwd(), fullPath);

            if (shouldIgnoreEntry(dirent, ignorePatterns)) {
                continue;
            }

            if (dirent.isDirectory()) {
                if (recursive) {
                    const subResults = await search_files(relativePath, regex, true);
                    if (subResults !== '(no files)' && !subResults.startsWith('ERROR:')) {
                        results = results.concat(subResults.split('\n'));
                    }
                }
            } else if (dirent.isFile()) {
                try {
                    const content = await fsp.readFile(fullPath, 'utf-8');
                    let match;
                    while ((match = searchRegex.exec(content)) !== null) {
                        const lineStart = content.lastIndexOf('\n', match.index) + 1;
                        const lineEnd = content.indexOf('\n', match.index);
                        const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);
                        results.push(`${relativePath}:${content.substring(0, match.index).split('\n').length}: ${line}`);
                    }
                } catch (readError: any) {
                    // Ignore errors for unreadable files
                }
            }
        }
    } catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            return `ERROR: Directory not found or not accessible: ${dirPath}`;
        }
        throw error;
    }

    return results.join('\n');
}

async function list_code_definitions(dirPath: string, recursive: boolean = false): Promise<string> {
    let definitions: string[] = [];
    const absoluteDirPath = path.resolve(process.cwd(), dirPath);
    const ignorePatterns = getGitIgnorePatterns(absoluteDirPath);

    try {
        const dirents = await fsp.readdir(absoluteDirPath, { withFileTypes: true });

        for (const dirent of dirents) {
            const fullPath = path.resolve(absoluteDirPath, dirent.name);
            const relativePath = path.relative(process.cwd(), fullPath);

            if (shouldIgnoreEntry(dirent, ignorePatterns)) {
                continue;
            }

            if (dirent.isDirectory()) {
                if (recursive) {
                    const subDefinitions = await list_code_definitions(relativePath, true);
                    if (subDefinitions !== '(no files)' && !subDefinitions.startsWith('ERROR:')) {
                        definitions = definitions.concat(subDefinitions.split('\n'));
                    }
                }
            } else if (dirent.isFile()) {
                const fileExtension = path.extname(dirent.name).toLowerCase();
                const definitionsForLanguage = languageDefinitions[fileExtension];

                if (definitionsForLanguage) { // Check if we have patterns for this language
                    try {
                        const content = await fsp.readFile(fullPath, 'utf-8');
                        const lines = content.split('\n');

                        lines.forEach((line, index) => {
                            definitionsForLanguage.forEach(def => {
                                const match = line.match(def.regex);
                                if (match) {
                                    definitions.push(`${relativePath}:${index + 1}: ${def.type} ${match[1]}`);
                                }
                            });
                        });

                    } catch (readError: any) {
                        // Ignore errors for unreadable files
                    }
                }
            }
        }
    } catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            return `ERROR: Directory not found or not accessible: ${dirPath}`;
        }
        throw error;
    }

    return definitions.join('\n');
}

async function replace_in_file(filePath: string, regex: string, substitution: string): Promise<string> {
    try {
        const absolutePath = path.resolve(process.cwd(), filePath);
        let content = await fsp.readFile(absolutePath, 'utf-8');
        const originalContent = content; // Store original content

        const searchRegex = new RegExp(regex, 's'); // 's' (dotAll) flag to allow '.' to match newlines
        content = content.replace(searchRegex, substitution);

        if (content === originalContent) {
            return `ERROR: No match found or no change occurred for regex "${regex}" in file ${filePath}`;
        }

        await fsp.writeFile(absolutePath, content, 'utf-8');
        return `File modified successfully: ${filePath}`;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return `ERROR: File not found at ${filePath}`;
        }
        return `ERROR: Could not modify file ${filePath}: ${error.message}`;
    }
}
