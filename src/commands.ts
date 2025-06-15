import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

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
