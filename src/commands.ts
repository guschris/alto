import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

export const executeCommandToolSchema = {
  type: "function",
  function: {
    name: "execute_command",
    description: "Executes a shell command on the system.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        requires_approval: {
          type: "boolean",
          description: "Set to true if the command requires user approval before execution (e.g., for destructive commands like 'rm -rf').",
        },
      },
      required: ["command", "requires_approval"],
    },
  },
};

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
