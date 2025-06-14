import * as fs from 'fs';
import * as fsp from 'fs/promises'; // Import fs.promises
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';


const execPromise = util.promisify(exec);

export function extractCommand(response: string): string|null {
    const startMarker = "----START_SH----";
    const endMarker = "----END_SH----";

    const startIndex = response.indexOf(startMarker);
    if (startIndex === -1) {
        return null;
    }

    const endIndex = response.indexOf(endMarker, startIndex + startMarker.length);
    if (endIndex === -1) {
        return null;
    }

    // Extract the content between the markers, which is now the raw shell command
    const shellCommand = response.substring(startIndex + startMarker.length, endIndex).trim();
    return shellCommand;
}

export async function runCommand(command: string): Promise<string> {
    try {
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            console.error("Command returned stderr: " + stderr);
        }
        return stdout;
    } catch (error: any) {
        return `ERROR: Command failed: ${error.message}\n${error.stderr}`;
    }
}
