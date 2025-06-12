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

let config: Config;

try {
  const configPath = path.join(__dirname, '..', 'config.json');
  const configFile = readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
} catch (error) {
  console.error('Error loading config.json:', error);
  process.exit(1);
}

async function chatWithOpenAI(prompt: string) {
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
        messages: [{ role: 'user', content: prompt }],
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
    let isStreamingThinking = false;

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
            const reasoningContent = data.choices[0]?.delta?.reasoning_content;
            const content = data.choices[0]?.delta?.content;

            if (reasoningContent) {
              if (!isStreamingThinking) {
                process.stdout.write('THINKING: ');
                isStreamingThinking = true;
              }
              const parts = reasoningContent.split('\n');
              for (let i = 0; i < parts.length; i++) {
                process.stdout.write(parts[i]);
                if (i < parts.length - 1) {
                  process.stdout.write('\nTHINKING: ');
                }
              }
            } else {
              if (isStreamingThinking) {
                process.stdout.write('\n');
                isStreamingThinking = false;
              }
              if (content) {
                process.stdout.write(content);
              }
            }
          } catch (e) {
            // console.error('Error parsing JSON:', e, 'Line:', jsonStr);
          }
        }
      }
    }
    if (isStreamingThinking) { // Ensure a newline if thinking ended right before stream finished
      process.stdout.write('\n');
    }
    process.stdout.write('\n'); // Newline after the streamed response
  } catch (error) {
    console.error('Error communicating with OpenAI:', error);
  }
}


function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('AI Coding Assistant CLI');
  console.log('Type "/help" for available commands'); // Updated help message

  rl.on('line', async (input) => { // Made async to await chatWithOpenAI
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case '/exit':
        console.log('Goodbye!');
        rl.close();
        break;
      case '/help':
        console.log('Available commands:');
        console.log('  /exit   - Quit the application');
        console.log('  /help   - Show this help message');
        break;
      default:
        // Send unknown commands to the chatbot
        console.log(`Sending to AI: ${input}`);
        await chatWithOpenAI(input.trim());
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main();
