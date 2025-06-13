import { isCommandStartTag, isCommandEndTag } from './commands';

const THINKING_COLOR = '\x1b[90m'; // Dark grey for thinking messages
const COMMAND_XML_COLOR = '\x1b[33m'; // Dark yellow for command XML messages
const RESET_COLOR = '\x1b[0m';

export class StreamOutputFormatter {
  private buffer: string = '';
  private isInsideCommand: boolean = false;
  private currentCommand: string = '';
  private isStreamingThinking: boolean = false;

  constructor() {
    // Ensure initial state is clean
    process.stdout.write(RESET_COLOR);
  }

  public writeThinking(chunk: string): void {
    if (!this.isStreamingThinking) {
      this.flush(); // Flush any pending content before switching mode
      process.stdout.write(THINKING_COLOR + 'THINKING: ');
      this.isStreamingThinking = true;
    }
    process.stdout.write(chunk);
  }

  public writeContent(chunk: string): void {
    if (this.isStreamingThinking) {
      process.stdout.write(RESET_COLOR + '\n');
      this.isStreamingThinking = false;
    }

    this.buffer += chunk;

    while (this.buffer.length > 0) {
      if (!this.isInsideCommand) {
        const commandName = isCommandStartTag(this.buffer);
        if (commandName) {
          const startTag = `<${commandName}>`;
          const startTagIndex = this.buffer.indexOf(startTag);
          
          // Write content before the start tag
          if (startTagIndex > 0) {
            process.stdout.write(this.buffer.substring(0, startTagIndex));
          }
          
          // Switch to command color and write the start tag
          process.stdout.write(COMMAND_XML_COLOR + startTag);
          this.isInsideCommand = true;
          this.currentCommand = commandName;
          this.buffer = this.buffer.substring(startTagIndex + startTag.length);
        } else {
          // No start tag found, write all content up to the last potential start of a tag
          const lastBracket = this.buffer.lastIndexOf('<');
          if (lastBracket === -1) {
            process.stdout.write(this.buffer);
            this.buffer = '';
          } else {
            process.stdout.write(this.buffer.substring(0, lastBracket));
            this.buffer = this.buffer.substring(lastBracket);
          }
          break; // Wait for more chunks if no full tag or text to write
        }
      } else { // isInsideCommand
        const endTag = `</${this.currentCommand}>`;
        const endTagIndex = this.buffer.indexOf(endTag);

        if (endTagIndex !== -1) {
          // Write content up to and including the end tag
          process.stdout.write(this.buffer.substring(0, endTagIndex + endTag.length));
          this.buffer = this.buffer.substring(endTagIndex + endTag.length);
          
          // Reset color and state
          process.stdout.write(RESET_COLOR);
          this.isInsideCommand = false;
          this.currentCommand = '';
        } else {
          // End tag not found yet, write the entire buffer (content within command)
          process.stdout.write(this.buffer);
          this.buffer = '';
          break; // Wait for more chunks
        }
      }
    }
  }

  public flush(): void {
    if (this.buffer) {
      process.stdout.write(this.buffer);
      this.buffer = '';
    }
    if (this.isStreamingThinking || this.isInsideCommand) {
      process.stdout.write(RESET_COLOR);
      this.isStreamingThinking = false;
      this.isInsideCommand = false;
      this.currentCommand = '';
    }
  }
}
