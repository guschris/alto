// src/cli.ts
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import path from 'path';
import { altoSystemPrompt } from './system';
import { extractCommand, runCommand } from './commands';

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface Config {
  openai: OpenAIConfig;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

let config: Config;
let chatHistory: ChatMessage[] = [];
let systemPrompt: string = altoSystemPrompt();

try {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configFile = readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('Error loading config.json:', error);
  process.exit(1);
}

/**
 * Communicates with the OpenAI API to get a chat completion stream.
 * This function is an asynchronous generator that yields data chunks as they are received.
 * @param messages The array of chat messages, including previous history and the current prompt.
 * @returns An asynchronous generator that yields parsed JSON data chunks from the API.
 */
async function* chatWithOpenAI(messages: ChatMessage[]) {
  const { apiKey, baseUrl, model } = config.openai;
  const url = `${baseUrl}/chat/completions`;

  try {
    const msg: any = {
      model: model,
      messages: messages,
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(msg)
    });

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
  } catch (error) {
    console.error('Error communicating with OpenAI:', error);
  }
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
      data.data.forEach((model: any) => {
        console.log(`- ${model.id}`);
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
 * @param stream An asynchronous generator yielding data chunks from the chat completion.
 */
async function handleChatStreamOutput(stream: AsyncGenerator<any>): Promise<string> {
  let isStreamingThinking = false;
  let assistantResponseContent = ''; // Accumulate assistant's content for chat history
  const GREY_COLOR = '\x1b[90m'; // Dark grey
  const RESET_COLOR = '\x1b[0m'; // Reset color

  let mergedResponse: any = {
    choices: [],
    usage: {},
    timings: {}
  };

  for await (const data of stream) {
    // Accumulate usage and timings from the last chunk (usually contains final values)
    if (data.usage) {
      mergedResponse.usage = data.usage;
    }
    if (data.timings) {
      mergedResponse.timings = data.timings;
    }

    if (data.choices) {
      data.choices.forEach((chunkChoice: any) => {
        const choiceIndex = chunkChoice.index;
        // Find or create the corresponding choice in mergedResponse
        let mergedChoice = mergedResponse.choices[choiceIndex];
        if (!mergedChoice) {
          mergedChoice = { index: choiceIndex, delta: {}, finish_reason: null };
          mergedResponse.choices[choiceIndex] = mergedChoice;
        }

        // Merge delta properties for final output/history
        if (chunkChoice.delta) {
          const delta = chunkChoice.delta;

          // Stream content and reasoning_content immediately
          if (delta.reasoning_content) {
            if (!isStreamingThinking) {
              process.stderr.write(GREY_COLOR + 'THINKING: ');
              isStreamingThinking = true;
            }
            process.stdout.write(delta.reasoning_content);
            mergedChoice.delta.reasoning_content = (mergedChoice.delta.reasoning_content || '') + delta.reasoning_content;
          } else {
            if (isStreamingThinking) {
              process.stderr.write(RESET_COLOR + '\n');
              isStreamingThinking = false;
            }
            if (delta.content) {
              process.stdout.write(delta.content);
              assistantResponseContent += delta.content; // Accumulate for chat history
              mergedChoice.delta.content = (mergedChoice.delta.content || '') + delta.content;
            }
          }

        }

        // Store finish_reason
        if (chunkChoice.finish_reason) {
          mergedChoice.finish_reason = chunkChoice.finish_reason;
        }
      });
    }

    // Check for stream end based on the first choice's finish_reason
    // This assumes all choices finish around the same time or we only care about the first one for stream termination.
    // If multiple choices can finish at different times, this logic might need adjustment.
    if (data.choices[0]?.finish_reason) {
      break; // End of output
    }
  }

  if (isStreamingThinking) { // Ensure a newline and reset if thinking ended right before stream finished
    process.stderr.write(RESET_COLOR);
  }
  process.stdout.write('\n'); // Newline after the streamed response

  // Display usage and timings
  if (mergedResponse.usage && mergedResponse.timings) {
    const { usage, timings } = mergedResponse;
    let outputString = `\n${GREY_COLOR}Total Tokens: ${usage.total_tokens}`;
    if (contextWindowSize !== null) {
      const percentUsed = ((usage.total_tokens / contextWindowSize) * 100).toFixed(2);
      outputString += ` / ${contextWindowSize} (${percentUsed}%)`;
    }
    if (timings.prompt_per_second) outputString += ` | Prompt PPS: ${timings.prompt_per_second.toFixed(2)}`;
    if (timings.predicted_per_second) outputString += ` | Predicted PPS: ${timings.predicted_per_second.toFixed(2)}${RESET_COLOR}\n`;
    process.stderr.write(outputString);
  }

  // Add assistant's response to chat history
  if (assistantResponseContent.length > 0) {
    chatHistory.push({ role: 'assistant', content: assistantResponseContent });
  }
  return assistantResponseContent;
}

async function chat(input: string) {
  chatHistory.push({ role: 'user', content: input });
  while (true) {
      const chatStream = chatWithOpenAI(chatHistory);
      const response = await handleChatStreamOutput(chatStream);
      const commandXml = extractCommand(response);
      if (!commandXml) break;
      const commandResponse = await runCommand(commandXml);
      chatHistory.push({ role: 'system', content: commandResponse });
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

function showHelp() {
  console.log('Available commands:');
  console.log('  /exit    - Quit the application');
  console.log('  /help    - Show this help message');
  console.log('  /models  - List available OpenAI models');
  console.log('  /clear   - Clear chat history');
  console.log('  /history - Show chat history');
  console.log('  /system <prompt> - Set the system prompt for the chatbot');
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
 * Main function to initialize the CLI, load configuration, and handle user input.
 */
async function main() { // Make main async
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('AI Coding Assistant CLI');
  console.log('Type "/help" for available commands'); // Updated help message

  contextWindowSize = await fetchContextWindowSize(); // Fetch context window size at startup
  clearChatHistory(); // setup the system prompt

  rl.on('line', async (input) => { // Made async to await chatWithOpenAI
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case '/exit':
        console.log('Goodbye!');
        rl.close();
        break;
      case '/help':
        showHelp();
        break;
      case command.startsWith('/system ') ? command : '': // Handle /system command
        setSystemPrompt(input);
        break;
      case '/models':
        console.log('Fetching available models...');
        await listOpenAIModels();
        break;
      case '/clear':
        clearChatHistory();
        console.log('Chat history cleared.');
        break;
      case '/history':
        showChatHistory();
        break;
      default:
        await chat(input.trim())
        break;
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main();