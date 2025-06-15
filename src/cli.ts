// src/cli.ts
import { createInterface } from 'readline';
import { readFileSync, promises as fsPromises } from 'fs'; // Import promises
import * as path from 'path';
import { runCommand } from './commands';
import Spinner from './spinner'; // Import the new Spinner class
import { StreamOutputFormatter } from './outputFormatter'; // Import the new formatter

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  
  // request is sent in the body of the request to the chat endpoint
  request: {
    model: string;
     
    // common openrouter settings
    include_reasoning?: boolean;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    provider?: {
      sort?: string;
      only?: string;
    }
  }
}

interface Config {
  openai: OpenAIConfig;
  chatTimeout?: number | string; // Optional timeout setting, can be number or string
}

// global spinner
const spinner = new Spinner();

function altoSystemPrompt(): string {
    const promptPath = path.join(__dirname, 'scripts', 'system-prompt.md');
    const promptContent = readFileSync(promptPath, 'utf8');
    process.stdout.write(`\x1b[90mSystem prompt loaded from: ${promptPath}\x1b[0m\n`); // Grey color for system messages
    return promptContent;
}

/**
 * Parses a time string (e.g., "10s", "5m", "2h") into milliseconds.
 * Supports 's' for seconds, 'm' for minutes, 'h' for hours.
 * Case-insensitive for units.
 * @param timeString The time string to parse.
 * @returns The time in milliseconds.
 * @throws Error if the format is invalid.
 */
function parseTimeStringToMs(timeString: string): number {
    const trimmed = timeString.trim();
    const match = trimmed.match(/^(\d+)\s*([smh])$/i);

    if (!match) {
        throw new Error(`Invalid time string format: "${timeString}". Expected format like "10s", "5m", "2h".`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        default:
            // This case should ideally not be reached due to regex, but as a safeguard
            throw new Error(`Unknown time unit: "${unit}" in "${timeString}".`);
    }
}

interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
}

interface FunctionCall {
  name: string;
  arguments: string; // JSON string
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: { id: string; type: "function"; function: FunctionCall }[];
  tool_call_id?: string;
}

let config: Config;
let chatHistory: ChatMessage[] = [];
let systemPrompt: string = altoSystemPrompt();
let currentMultiLinePrompt = '';

try {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configFile = readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('Error loading config.json:', error);
  process.exit(1);
}

const tools = [
  {
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
  },
];

/**
 * Communicates with the OpenAI API to get a chat completion stream.
 * This function is an asynchronous generator that yields data chunks as they are received.
 * @param messages The array of chat messages, including previous history and the current prompt.
 * @returns An asynchronous generator that yields parsed JSON data chunks from the API.
 */
async function* chatWithOpenAI(messages: ChatMessage[]) {
  const { apiKey, baseUrl, request } = config.openai;
  const url = `${baseUrl}/chat/completions`;

  try {
    const msg: any = {
      ...request,
      messages: messages,
      stream: true,
      tools: tools,
      tool_choice: "auto" // This allows the model to decide whether to call a tool or respond
    };
    if (config.openai.baseUrl.includes("openrouter.ai")) {
      msg.include_reasoning = true;
    }

    const controller = new AbortController();
    const chatTimeout = getChatTimeout();
    const timeoutId = setTimeout(() => controller.abort(), chatTimeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(msg),
      signal: controller.signal // Associate the signal with the fetch request
    });

    clearTimeout(timeoutId); // Clear the timeout if the fetch completes before timeout

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get readable stream from response.');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, newlineIndex).trim();
        buffer = buffer.substring(newlineIndex + 1);

        if (line.startsWith('data:')) {
          const jsonStr = line.substring(5).trim();
          if (jsonStr === '[DONE]') {
            break;
          }
          try {
            const data = JSON.parse(jsonStr);
            yield data;
          } catch (e) {
            // console.error('Error parsing JSON:', e, 'Line:', jsonStr);
          }
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('Error communicating with OpenAI: Request timed out.');
    } else {
      console.error('Error communicating with OpenAI:', error);
    }
  }
}

function getChatTimeout() {
  let chatTimeoutValue = 600000; // Default to 10 minutes (600000 ms)

  if (typeof config.chatTimeout === 'string') {
    try {
      chatTimeoutValue = parseTimeStringToMs(config.chatTimeout);
    } catch (e: any) {
      console.error(`Warning: Invalid chatTimeout in config.json: ${e.message}. Using default 10 minutes.`);
    }
  } else if (typeof config.chatTimeout === 'number' && config.chatTimeout > 0) {
    chatTimeoutValue = config.chatTimeout;
  }
  return chatTimeoutValue;
}

/**
 * Fetches and lists available models from the OpenAI API.
 */
async function listOpenAIModels() {
  const { apiKey, baseUrl } = config.openai;
  const url = `${baseUrl}/models`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('\nAvailable Models:');
    if (data.data && Array.isArray(data.data)) {
      const models: string[] = data.data.map((model:any) => model.id);
      models.sort();
      models.forEach(m => {
        console.log(`- ${m}`);
      });
    } else {
      console.log('No models found or unexpected response format.');
    }
    console.log(''); // Add a newline for better formatting
  } catch (error) {
    console.error('Error listing models:', error);
  }
}

/**
 * Fetches the context window size (n_ctx_train) for the first available model from the OpenAI API.
 * @returns The context window size as a number, or null if not found or an error occurs.
 */
let contextWindowSize: number | null = null;

async function fetchContextWindowSize(): Promise<number | null> {
  const { apiKey, baseUrl } = config.openai;
  const url = `${baseUrl}/models`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const firstModel = data.data[0];
      if (firstModel.meta && typeof firstModel.meta.n_ctx_train === 'number') {
        return firstModel.meta.n_ctx_train;
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching context window size:', error);
    return null;
  }
}

/**
 * Handles the asynchronous stream of chat completion data and outputs it to the console.
 * This function manages the display of reasoning content, regular content, and performance metrics.
 * @param stream An asynchronous generator yielding data chunks as they are received.
 */
async function handleChatStreamOutput(stream: AsyncGenerator<any>): Promise<{
  content: string;
  toolCalls: { id: string; type: "function"; function: FunctionCall }[];
}> {
  let assistantResponseContent = '';
  const formatter = new StreamOutputFormatter();
  let toolCalls: { id: string; type: "function"; function: FunctionCall }[] = [];

  let mergedResponse: any = {
    choices: [],
    usage: {},
    timings: {}
  };

  for await (const data of stream) {
    spinner.stop();

    if (data.usage) mergedResponse.usage = data.usage;
    if (data.timings) mergedResponse.timings = data.timings;

    if (data.choices) {
      for (const chunkChoice of data.choices) {
        const choiceIndex = chunkChoice.index;
        let mergedChoice = mergedResponse.choices[choiceIndex];
        if (!mergedChoice) {
          mergedChoice = { index: choiceIndex, delta: {}, finish_reason: null };
          mergedResponse.choices[choiceIndex] = mergedChoice;
        }

        if (chunkChoice.delta) {
          const delta = chunkChoice.delta;

          if (delta.tool_calls) {
            if (!mergedChoice.delta.tool_calls) {
              mergedChoice.delta.tool_calls = [];
            }
            for (const toolCall of delta.tool_calls) {
              if (toolCall.index !== undefined) {
                if (!mergedChoice.delta.tool_calls[toolCall.index]) {
                  mergedChoice.delta.tool_calls[toolCall.index] = {
                    id: toolCall.id || '',
                    type: toolCall.type,
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: toolCall.function?.arguments || ''
                    }
                  };
                } else {
                  // Append to existing tool call arguments
                  mergedChoice.delta.tool_calls[toolCall.index].function.arguments += toolCall.function?.arguments || '';
                }
                formatter.writeToolCall(toolCall.function?.arguments as string);
              }
            }
            // Update toolCalls array with the current state
            toolCalls = mergedChoice.delta.tool_calls.filter((tc: any) => tc); // Remove any undefined entries
          }

          if (delta.content) {
            assistantResponseContent += delta.content;
            formatter.writeContent(delta.content);
          } else if (delta.reasoning_content) { // qwen3 running on llama.cpp
            formatter.writeThinking(delta.reasoning_content);
          } else if (delta.reasoning) { // deepseek or qwen3 on openrouter.ai
            formatter.writeThinking(delta.reasoning);
          }
        }

        if (chunkChoice.finish_reason) {
          mergedChoice.finish_reason = chunkChoice.finish_reason;
        }
      }
    }

    if (data?.choices[0]?.finish_reason) {
      break;
    }
  }

  formatter.flush();
  process.stdout.write('\n'); // Add a newline after the stream output

  displayUsageAndTimings(mergedResponse.usage, mergedResponse.timings);

  return {
    content: assistantResponseContent,
    toolCalls: toolCalls
  };
}

function displayUsageAndTimings(usage: any, timings: any) {
  if (usage && usage.total_tokens) {
    const THINKING_COLOR = '\x1b[90m'; // Define locally for this function
    const RESET_COLOR = '\x1b[0m';
    let outputString = `\n${THINKING_COLOR}Total Tokens: ${usage.total_tokens}`;
    if (contextWindowSize !== null) {
      const percentUsed = ((usage.total_tokens / contextWindowSize) * 100).toFixed(2);
      outputString += ` / ${contextWindowSize} (${percentUsed}%)`;
    }
    if (timings) {
      if (timings.prompt_per_second) outputString += ` | Prompt PPS: ${timings.prompt_per_second.toFixed(2)}`;
      if (timings.predicted_per_second) outputString += ` | Predicted PPS: ${timings.predicted_per_second.toFixed(2)}${RESET_COLOR}\n`;
    }
    process.stdout.write(outputString);
  }
}

async function chat(input: string) {
  chatHistory.push({ role: 'user', content: input });

  while (true) {
    try {
      spinner.start(); // Use default random message from Spinner class
      const chatStream = chatWithOpenAI(chatHistory);
      const { content, toolCalls } = await handleChatStreamOutput(chatStream);
      
      // Create assistant message with content and tool calls
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      };
      chatHistory.push(assistantMessage);

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === "execute_command") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const command = args.command;
              const requiresApproval = args.requires_approval;

              if (requiresApproval) {
                const rl = createInterface({
                  input: process.stdin,
                  output: process.stdout,
                });
                const answer = await new Promise<string>(resolve => {
                  rl.question(`\x1b[31mApproval needed for command: \x1b[36m${command}\x1b[0m\nExecute? (yes/no): `, resolve);
                });
                rl.close();

                if (answer.toLowerCase() !== 'yes') {
                  chatHistory.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `Command execution denied by user: ${command}`
                  });
                  return; // Stop chat if command denied
                }
              }

              spinner.start(`Executing command: ${command}...`);
              const commandOutput = await runCommand(command);
              spinner.stop();
              chatHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: commandOutput
              });
            } catch (error: any) {
              spinner.stop();
              console.error('Tool execution error:', error);
              chatHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `ERROR: Tool execution failed: ${error.message}`
              });
              return; // Stop chat on tool execution error
            }
          } else {
            // Handle other tools or unknown tools
            chatHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `ERROR: Unknown tool: ${toolCall.function.name}`
            });
            return; // Stop chat on unknown tool
          }
        }
      } else {
        // If no tool calls, and assistant responded with content, then we are done
        return;
      }
    } catch (error) {
      console.error('Chat error:', error);
      spinner.stop();
      return; // Exit on chat error
    } finally {
      spinner.stop(); // Ensure spinner is stopped
    }
  }
}

function clearChatHistory() {
  chatHistory = [ { role: "system", content: systemPrompt }];
}

function showChatHistory() {
  if (chatHistory.length === 0) {
    console.log('Chat history is empty.');
  } else {
    console.log('\n--- Chat History ---');
    chatHistory.filter(msg => msg.role !== "system").forEach((msg, index) => {
      console.log(`${index + 1}. ${msg.role.toUpperCase()}: ${msg.content}`);
    });
    console.log('--------------------\n');
  }
}

async function showHelp() { // Made async
  console.log('Available commands:');
  console.log('  /exit    - Quit the application');
  console.log('  /help    - Show this help message');
  console.log('  /models  - List available OpenAI models');
  console.log('  /clear   - Clear chat history');
  console.log('  /history - Show chat history');
  console.log('  /system <prompt> - Set the system prompt for the chatbot');
  console.log('    (To permanently change the default system prompt, edit scripts/system-prompt.md)');
  console.log('  /go      - Submit a multi-line prompt');
  console.log('  /<filename> - Submit content from a file in scripts/ (e.g., /commit)');

  const scriptDir = path.join(__dirname, 'scripts');
  try {
    const files = await fsPromises.readdir(scriptDir);
    const scriptFiles = files.filter(file => 
      (file.endsWith('.md') || file.endsWith('.txt')) && file !== 'system-prompt.md' // Exclude system-prompt.md
    );
    if (scriptFiles.length > 0) {
      console.log('\nAvailable scripts (use /<script_name>):');
      scriptFiles.forEach(file => {
        const scriptName = path.parse(file).name;
        console.log(`  /${scriptName}`);
      });
    }
  } catch (error) {
    console.error(`Error listing scripts: ${error}`);
  }
}

function setSystemPrompt(input: string) {
  systemPrompt = input.substring('/system '.length).trim();
  if (systemPrompt) {
    console.log(`System prompt set to: "${systemPrompt}"`);
  } else {
    console.log('System prompt cleared.');
  }
}


/**
 * Handles commands to submit content from a file.
 * @param fileName The name of the file (without path or extension) to read from src/scripts.
 */
async function handleFileCommand(fileName: string) {
  const scriptDir = path.join(__dirname, 'scripts');
  const possibleExtensions = ['.md', '.txt'];
  let filePath = '';
  let fileFound = false;

  for (const ext of possibleExtensions) {
    const potentialPath = path.join(scriptDir, fileName + ext);
    try {
      await fsPromises.access(potentialPath, fsPromises.constants.R_OK);
      filePath = potentialPath;
      fileFound = true;
      break;
    } catch (e) {
      // File not found or not readable, try next extension
    }
  }

  if (fileFound) {
    try {
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');
      console.log(`Submitting content from ${filePath}...`);
      await chat(fileContent);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
    }
  } else {
    console.log(`File "${fileName}" not found in src/scripts with .md or .txt extension.`);
  }
}

/**
 * Main function to initialize the CLI, load configuration, and handle user input.
 */
async function main() { // Make main async
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Alto> '
  });

  console.log('Alto - pair programming AI is ready!');
  console.log('Type "/help" for available commands. Enter multi-line prompts and type "/go" or an empty line to submit.');

  contextWindowSize = await fetchContextWindowSize(); // Fetch context window size at startup
  clearChatHistory(); // setup the system prompt
  
  if (process.stdin.isTTY) {
    rl.prompt(); // Display the initial prompt only in interactive mode
  }

  let isInteractive = process.stdin.isTTY;
  
  // Handle readline close event
  rl.on('close', () => {
    if (!isInteractive) {
      process.exit(0);
    }
  });
  
  for await (const input of rl) {
    const trimmedInput = input.trim();
    const lowercasedInput = trimmedInput.toLowerCase();

    switch (lowercasedInput) {
      case '/exit':
        console.log('Goodbye!');
        rl.close();
        return; // Exit the main function after closing readline
      case '/help':
        await showHelp();
        if (isInteractive) rl.prompt();
        break;
      case '/models':
        console.log('Fetching available models...');
        await listOpenAIModels();
        if (isInteractive) rl.prompt();
        break;
      case '/clear':
        clearChatHistory();
        console.log('Chat history cleared.');
        if (isInteractive) rl.prompt();
        break;
      case '/history':
        showChatHistory();
        if (isInteractive) rl.prompt();
        break;
      case '/go':
        if (currentMultiLinePrompt.trim().length > 0) {
          await chat(currentMultiLinePrompt.trim());
        } else {
          console.log('Multi-line prompt is empty. Nothing to submit.');
        }
        currentMultiLinePrompt = ''; // Always reset after /go
        if (isInteractive) rl.prompt();
        break;
      case '/system-prompt': // Prevent /system-prompt from being treated as a custom script
        console.log('To permanently change the default system prompt, edit the file scripts/system-prompt.md directly.');
        if (isInteractive) rl.prompt();
        break;
      default:
        // Handle /system command explicitly here
        if (lowercasedInput.startsWith('/system ')) {
          setSystemPrompt(input);
          if (isInteractive) rl.prompt();
        } else if (lowercasedInput.startsWith('/')) {
          const fileName = trimmedInput.substring(1); // Remove the leading '/'
          await handleFileCommand(fileName);
          if (isInteractive) rl.prompt();
        } else {
          // If it's an empty line and there's content in the multi-line prompt, submit it
          if (trimmedInput.length === 0 && currentMultiLinePrompt.trim().length > 0) {
            await chat(currentMultiLinePrompt.trim());
            currentMultiLinePrompt = ''; // Reset after submission
            if (isInteractive) rl.prompt();
          } else {
            // Otherwise, it's part of the multi-line prompt
            currentMultiLinePrompt += (currentMultiLinePrompt.length > 0 ? '\n' : '') + input;
            // For non-interactive mode, if we have input, process it immediately
            if (!isInteractive && currentMultiLinePrompt.trim().length > 0) {
              await chat(currentMultiLinePrompt.trim());
              currentMultiLinePrompt = '';
              rl.close();
              return;
            }
            if (isInteractive) rl.prompt();
          }
        }
        break;
    }
  }

  // This part will only be reached if rl.close() is called, e.g., by /exit
  process.exit(0);
}

main();
