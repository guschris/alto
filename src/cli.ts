// src/cli.ts
import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import path from 'path';

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface Config {
  openai: OpenAIConfig;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

let config: Config;
let chatHistory: ChatMessage[] = [];

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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true
      })
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
/**
 * Fetches and lists available models from the OpenAI API.
 */
async function listOpenAIModels() {
  const { apiKey, baseUrl } = config.openai;
  const url = `${baseUrl}/models`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
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
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
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
async function handleChatStreamOutput(stream: AsyncGenerator<any>) {
  let isStreamingThinking = false;
  let assistantResponseContent = ''; // Accumulate assistant's content
  const GREY_COLOR = '\x1b[90m'; // Dark grey
  const RESET_COLOR = '\x1b[0m'; // Reset color

  for await (const data of stream) {
    const reasoningContent = data.choices[0]?.delta?.reasoning_content;
    const content = data.choices[0]?.delta?.content;
    const finishReason = data.choices[0]?.finish_reason;

    if (reasoningContent) {
      if (!isStreamingThinking) {
        process.stdout.write(GREY_COLOR + 'THINKING: ');
        isStreamingThinking = true;
      }
      process.stdout.write(reasoningContent);
    } else {
      if (isStreamingThinking) {
        process.stdout.write(RESET_COLOR + '\n');
        isStreamingThinking = false;
      }
      if (content) {
        process.stdout.write(content);
        assistantResponseContent += content; // Accumulate content
      }
    }

    if (finishReason === 'stop') {
      if (isStreamingThinking) {
        process.stdout.write(RESET_COLOR + '\n');
        isStreamingThinking = false;
      }
      const { usage, timings } = data;
      if (usage && timings) {
        process.stdout.write(GREY_COLOR);
        let outputString = `\nTotal Tokens: ${usage.total_tokens}`;
        if (contextWindowSize !== null) {
          const percentUsed = ((usage.total_tokens / contextWindowSize) * 100).toFixed(2);
          outputString += ` / ${contextWindowSize} (${percentUsed}%)`;
        }
        outputString += ` | Prompt PPS: ${timings.prompt_per_second.toFixed(2)}`;
        outputString += ` | Predicted PPS: ${timings.predicted_per_second.toFixed(2)}\n`;
        process.stdout.write(outputString);
        process.stdout.write(RESET_COLOR);
      }
      break; // End of output
    }
  }
  if (isStreamingThinking) { // Ensure a newline and reset if thinking ended right before stream finished
    process.stdout.write(RESET_COLOR + '\n');
  }
  process.stdout.write('\n'); // Newline after the streamed response

  // Add assistant's response to chat history
  if (assistantResponseContent.length > 0) {
    chatHistory.push({ role: 'assistant', content: assistantResponseContent });
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

  rl.on('line', async (input) => { // Made async to await chatWithOpenAI
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case '/exit':
        console.log('Goodbye!');
        rl.close();
        break;
      case '/help':
        console.log('Available commands:');
        console.log('  /exit    - Quit the application');
        console.log('  /help    - Show this help message');
        console.log('  /models  - List available OpenAI models');
        console.log('  /clear   - Clear chat history');
        console.log('  /history - Show chat history');
        break;
      case '/models':
        console.log('Fetching available models...');
        await listOpenAIModels();
        break;
      case '/clear':
        chatHistory = [];
        console.log('Chat history cleared.');
        break;
      case '/history':
        if (chatHistory.length === 0) {
          console.log('Chat history is empty.');
        } else {
          console.log('\n--- Chat History ---');
          chatHistory.forEach((msg, index) => {
            console.log(`${index + 1}. ${msg.role.toUpperCase()}: ${msg.content}`);
          });
          console.log('--------------------\n');
        }
        break;
      default:
        // Add user's message to chat history
        chatHistory.push({ role: 'user', content: input.trim() });

        // Send chat history to the chatbot
        const chatStream = chatWithOpenAI(chatHistory);
        await handleChatStreamOutput(chatStream);
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main();
