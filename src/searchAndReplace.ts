import * as fs from 'fs/promises';
import * as process from 'process'; // Keep for console.error reporting for internal logging

/**
 * Interface for a single search and replace operation.
 * Matches the structure expected by the OpenAI function call.
 */
interface PatchOperation {
    search_pattern: string[];   // The text (array of lines) to search for.
                                // Each string in the array is a line.
    replacement_text: string[]; // The text (array of lines) to replace the search_pattern with.
                                // Each string in the array is a line.
    before_context?: string[]; // Optional: Array of lines expected *before* the first line of search_pattern.
                               // The order matters: [line_N_above, ..., line_1_above]
    after_context?: string[];  // Optional: Array of lines expected *after* the last line of search_pattern.
                               // The order matters: [line_1_below, ..., line_N_below]
}

/**
 * Reads the content of the specified file.
 * @param filePath The path to the file.
 * @returns The content of the file as a string.
 * @throws {Error} If the file cannot be read.
 */
async function readFileContent(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
        throw new Error(`Error reading file "${filePath}": ${error.message}`);
    }
}

/**
 * Validates the structure and context requirements of each patch operation.
 * @param patchOperations The array of patch operations to validate.
 * @throws {Error} If any operation fails validation.
 */
function validatePatchOperations(patchOperations: PatchOperation[]): void {
    if (!Array.isArray(patchOperations)) {
        throw new Error('Patch operations must be a JSON array.');
    }

    for (const op of patchOperations) {
        if (!Array.isArray(op.search_pattern) || op.search_pattern.length === 0 || !op.search_pattern.every(l => typeof l === 'string')) {
            throw new Error('Each patch operation must have a non-empty "search_pattern" as an array of strings.');
        }
        if (!Array.isArray(op.replacement_text) || !op.replacement_text.every(l => typeof l === 'string')) {
            throw new Error('Each patch operation must have "replacement_text" as an array of strings.');
        }
        if (op.before_context && (!Array.isArray(op.before_context) || !op.before_context.every(l => typeof l === 'string'))) {
            throw new Error('"before_context" must be an array of strings if provided.');
        }
        if (op.after_context && (!Array.isArray(op.after_context) || !op.after_context.every(l => typeof l === 'string'))) {
            throw new Error('"after_context" must be an array of strings if provided.');
        }

        const hasBeforeContext = op.before_context && op.before_context.length >= 3;
        const hasAfterContext = op.after_context && op.after_context.length >= 3;

        if (!hasBeforeContext && !hasAfterContext) {
            throw new Error(
                'Each patch operation must have at least 3 lines of "before_context" OR ' +
                'at least 3 lines of "after_context".'
            );
        }
    }
}

/**
 * Applies a list of patch operations to an array of lines.
 * Modifies the `lines` array in place.
 * @param lines The array of lines to modify.
 * @param patchOperations The array of patch operations to apply.
 * @returns The number of changes made.
 */
function applyPatchOperations(lines: string[], patchOperations: PatchOperation[]): number {
    let changesMade = 0;

    // Iterate through each patch operation
    for (const patch of patchOperations) {
        const { search_pattern, replacement_text, before_context, after_context } = patch;
        const searchPatternLength = search_pattern.length;

        // Iterate through the lines of the file to find a match for the multi-line search_pattern
        // We stop searchPatternLength - 1 lines before the end to ensure a full block can be checked
        for (let i = 0; i <= lines.length - searchPatternLength; i++) {
            let searchPatternMatches = true;
            // Check if the current block of lines matches the search_pattern
            for (let k = 0; k < searchPatternLength; k++) {
                // Ensure we don't go out of bounds when checking the search pattern itself
                if (i + k >= lines.length || lines[i + k] !== search_pattern[k]) {
                    searchPatternMatches = false;
                    break;
                }
            }

            if (searchPatternMatches) {
                let contextMatches = true;

                // Verify before_context
                if (before_context) {
                    // Start checking from 'i - before_context.length' up to 'i - 1'
                    const startBeforeContextIndex = i - before_context.length;
                    if (startBeforeContextIndex < 0) {
                        contextMatches = false; // Not enough lines for before_context
                    } else {
                        for (let j = 0; j < before_context.length; j++) {
                            if (lines[startBeforeContextIndex + j] !== before_context[j]) {
                                contextMatches = false;
                                break;
                            }
                        }
                    }
                }

                // Verify after_context (only if before_context matched so far)
                if (contextMatches && after_context) {
                    // Start checking from 'i + searchPatternLength' up to 'i + searchPatternLength + after_context.length - 1'
                    const startAfterContextIndex = i + searchPatternLength;
                    if (startAfterContextIndex + after_context.length > lines.length) {
                        contextMatches = false; // Not enough lines for after_context
                    } else {
                        for (let j = 0; j < after_context.length; j++) {
                            if (lines[startAfterContextIndex + j] !== after_context[j]) {
                                contextMatches = false;
                                break;
                            }
                        }
                    }
                }

                // If all contexts and the search pattern match, perform the replacement
                if (contextMatches) {
                    // Remove the old lines and insert the new lines
                    lines.splice(i, searchPatternLength, ...replacement_text);
                    changesMade++;
                    
                    // Adjust the loop index 'i' to account for the change in array length
                    // and to prevent re-checking newly inserted lines for the same patch.
                    // The loop will increment 'i' by 1 at the end of this iteration,
                    // so we effectively move 'i' to the end of the new replacement block.
                    i += replacement_text.length - 1; 
                }
            }
        }
    }
    return changesMade;
}

/**
 * OpenAI Tool Schema for the `search_replace` function.
 * This object will be JSON serialized and provided to the OpenAI API.
 */
export const searchReplaceToolSchema = {
    type: "function",
    function: {
        name: "search_replace",
        description: "Applies structured search and replace operations to a file. Supports multi-line search and replacement, and requires at least 3 context lines (before or after) for each operation to ensure precision.",
        parameters: {
            type: "object",
            properties: {
                filePath: {
                    type: "string",
                    description: "The path to the file to be edited."
                },
                patch_operations: {
                    type: "array",
                    description: "An array of patch operations to apply. Each operation defines a multi-line search pattern, its multi-line replacement, and required context lines.",
                    items: {
                        type: "object",
                        properties: {
                            search_pattern: {
                                type: "array",
                                items: { type: "string" },
                                description: "An array of strings, where each string represents a line in the multi-line pattern to search for. Must be non-empty."
                            },
                            replacement_text: {
                                type: "array",
                                items: { type: "string" },
                                description: "An array of strings, where each string represents a line that will replace the search_pattern. Can be empty to delete lines."
                            },
                            before_context: {
                                type: "array",
                                items: { type: "string" },
                                description: "Optional: An array of strings representing lines expected *before* the search_pattern. Must have at least 3 lines if after_context is not provided or has less than 3 lines."
                            },
                            after_context: {
                                type: "array",
                                items: { type: "string" },
                                description: "Optional: An array of strings representing lines expected *after* the search_pattern. Must have at least 3 lines if before_context is not provided or has less than 3 lines."
                            }
                        },
                        required: ["search_pattern", "replacement_text"]
                    }
                }
            },
            required: ["filePath", "patch_operations"]
        }
    }
};

/**
 * Core function for applying search and replace operations to a file.
 * Designed to be called as an OpenAI function.
 * @param filePath The path to the file to be edited.
 * @param patch_operations An array of PatchOperation objects describing the changes.
 * @returns A promise that resolves with the modified file content as a string.
 * Rejects with an Error if any validation or file operation fails.
 */
export async function searchReplaceTool(filePath: string, patch_operations: PatchOperation[]): Promise<string> {
    try {
        validatePatchOperations(patch_operations);
        const fileContent = await readFileContent(filePath);
        let lines = fileContent.split(/\r?\n/);
        const changesMade = applyPatchOperations(lines, patch_operations);

        const modifiedContent = lines.join('\n');

        // Log report to stderr for internal debugging/monitoring
        console.error(`\n--- Tool Execution Report ---`);
        console.error(`File: ${filePath}`);
        console.error(`Changes applied: ${changesMade}`);
        console.error(`---------------------------\n`);

        return modifiedContent; // Return the processed content
    } catch (error: any) {
        // Log the error for internal debugging/monitoring
        console.error(`\n--- Tool Execution Error ---`);
        console.error(`Error in searchReplaceTool: ${error.message}`);
        console.error(`--------------------------\n`);
        throw error; // Re-throw the error to be handled by the tool calling mechanism
    }
}

// Example of how the tool could be used if run directly (for testing/demonstration)
// This part is for local execution simulation, not for actual OpenAI function call.
async function runLocalDemo() {
    // This mimics how a tool runner might call searchReplaceTool with arguments.
    // In a real scenario, these would come from the OpenAI model's tool_call.
    const demoFilePath = process.argv[2]; // Expect file path as the first CLI arg
    let demoPatchOperations: PatchOperation[] = [];

    // Read patch operations from stdin if available for local demo
    let stdinData = '';
    if (!process.stdin.isTTY) { // Check if stdin is piped (e.g., via '<' or '|')
        process.stdin.setEncoding('utf-8');
        for await (const chunk of process.stdin) {
            stdinData += chunk;
        }
        try {
            demoPatchOperations = JSON.parse(stdinData);
        } catch (error) {
            console.error('Error parsing demo patch operations from stdin:', error);
            process.exit(1);
        }
    } else {
        // Provide a default example if no stdin is piped and it's run without specific arguments
        // This is just for easier local testing without requiring a patches.json file always
        console.error("No stdin provided. Using a default example patch. Provide a file path as an argument.");
        console.error("Example: ts-node structured_editor.ts my_document.txt");
        console.error("Then paste JSON or pipe from a file.");
        
        // This is a minimal example, in a real scenario you'd want to load a test file and patches.
        // For demonstration, let's just exit or require proper usage.
        if (!demoFilePath) {
             console.error('Usage: ts-node <script_name>.ts <filepath> [< patches.json]');
             process.exit(1);
        }
        // A placeholder for actual demo operations if none provided via stdin,
        // typically you'd read a test JSON or have mock data here.
        // For this context, we will rely on external JSON input.
        console.error("Waiting for patch operations via stdin...");
        return; // Exit after printing usage, waiting for stdin
    }

    if (!demoFilePath) {
        console.error('Usage: ts-node <script_name>.ts <filepath> < patches.json');
        process.exit(1);
    }

    try {
        const modifiedContent = await searchReplaceTool(demoFilePath, demoPatchOperations);
        process.stdout.write(modifiedContent); // Print modified content to stdout
    } catch (error: any) {
        // Errors from searchReplaceTool are re-thrown, catch them here for the local demo.
        console.error(`Local demo failed: ${error.message}`);
        process.exit(1);
    }
}

// Only run the local demo if this file is executed directly.
// This allows other modules to import searchReplaceTool and searchReplaceToolSchema
// without triggering the command-line parsing.
if (require.main === module) {
    runLocalDemo();
}


/*
 * OpenAI Tool Schema (JSON serializable):
 * You would typically JSON.stringify(searchReplaceToolSchema) and send it to OpenAI API.
 *
 * {
 * "type": "function",
 * "function": {
 * "name": "search_replace",
 * "description": "Applies structured search and replace operations to a file. Supports multi-line search and replacement, and requires at least 3 context lines (before or after) for each operation to ensure precision.",
 * "parameters": {
 * "type": "object",
 * "properties": {
 * "filePath": {
 * "type": "string",
 * "description": "The path to the file to be edited."
 * },
 * "patch_operations": {
 * "type": "array",
 * "description": "An array of patch operations to apply. Each operation defines a multi-line search pattern, its multi-line replacement, and required context lines.",
 * "items": {
 * "type": "object",
 * "properties": {
 * "search_pattern": {
 * "type": "array",
 * "items": { "type": "string" },
 * "description": "An array of strings, where each string represents a line in the multi-line pattern to search for. Must be non-empty."
 * },
 * "replacement_text": {
 * "type": "array",
 * "items": { "type": "string" },
 * "description": "An array of strings, where each string represents a line that will replace the search_pattern. Can be empty to delete lines."
 * },
 * "before_context": {
 * "type": "array",
 * "items": { "type": "string" },
 * "description": "Optional: An array of strings representing lines expected *before* the search_pattern. Must have at least 3 lines if after_context is not provided or has less than 3 lines."
 * },
 * "after_context": {
 * "type: "array",
 * "items": { "type": "string" },
 * "description": "Optional: An array of strings representing lines expected *after* the search_pattern. Must have at least 3 lines if before_context is not provided or has less than 3 lines."
 * }
 * },
 * "required": ["search_pattern", "replacement_text"]
 * }
 * }
 * },
 * "required": ["filePath", "patch_operations"]
 * }
 * }
 * }
 *
 * Example Tool Call from OpenAI (Python pseudo-code):
 *
 * import openai
 *
 * client = openai.OpenAI(api_key="YOUR_OPENAI_API_KEY")
 *
 * # Assuming you've registered the tool schema with the OpenAI model
 * # tools = [searchReplaceToolSchema]
 *
 * # This is the type of dictionary/JSON the OpenAI model would generate
 * # for a tool_call to 'search_replace'
 * tool_call_arguments = {
 * "filePath": "my_document.txt",
 * "patch_operations": [
 * {
 * "search_pattern": [
 * "This is a block of code.",
 * "It has multiple lines.",
 * "Line 3 of the block."
 * ],
 * "replacement_text": [
 * "This is the NEW block.",
 * "It now has updated content."
 * ],
 * "before_context": [
 * "Header Line 1",
 * "Header Line 2",
 * "Header Line 3"
 * ]
 * },
 * {
 * "search_pattern": [
 * "Setting A = 10;",
 * "Setting B = 20;",
 * "Setting C = 30;"
 * ],
 * "replacement_text": [
 * "Setting A = 100;",
 * "Setting D = 400;"
 * ],
 * "after_context": [
 * "End of section.",
 * "Last line in file.",
 * ""
 * ]
 * }
 * ]
 * }
 *
 * # How you would typically call this in your backend (Node.js/TypeScript)
 * # Assuming `searchReplaceTool` is imported from this file:
 * # const { searchReplaceTool } = require('./structured_editor');
 * #
 * # async function handleToolCall() {
 * #   try {
 * #     const modifiedContent = await searchReplaceTool(
 * #       tool_call_arguments.filePath,
 * #       tool_call_arguments.patch_operations
 * #     );
 * #     console.log("Modified file content:", modifiedContent);
 * #     // Send modifiedContent back to OpenAI as a tool_output message
 * #   } catch (error) {
 * #     console.error("Tool execution failed:", error.message);
 * #     // Send error message back to OpenAI as a tool_output message
 * #   }
 * # }
 * # handleToolCall();
 */
