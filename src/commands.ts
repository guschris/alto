import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

export function extractCommand(response: string): { type: "command"|"error"|"none", content?: string} {
    const startMarker = "----START_SH----";
    const endMarker = "----END_SH----";

    const startIndex = response.indexOf(startMarker);
    if (startIndex === -1) {
        return { type: "none"};
    }
    
    const endIndex = response.lastIndexOf(endMarker, startIndex + startMarker.length);
    if (endIndex === -1) {
        return { type: "none"};
    }

    if (response.indexOf(startMarker, startIndex + startMarker.length) > startIndex) {
        return { type: "error", content: "You must only ever send ONE command per response, try again, but **one command at a time**" };
    }

    // Extract the content between the markers, which is now the raw shell command
    const shellCommand = response.substring(startIndex + startMarker.length, endIndex).trim();
    return { type: "command", content: shellCommand};
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
