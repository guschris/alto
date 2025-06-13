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

    let loopAgain = true;
    while (loopAgain) {
      loopAgain = false;
      if (!this.isInsideCommand) {
        const commandName = isCommandStartTag(this.buffer);
        if (commandName) {
          const startTagIndex = this.buffer.indexOf(`<${commandName}>`);
          const textBefore = this.buffer.substring(0, startTagIndex);
          process.stdout.write(textBefore);

          this.buffer = this.buffer.substring(startTagIndex);

          this.isInsideCommand = true;
          this.currentCommand = commandName;
          process.stdout.write(COMMAND_XML_COLOR);
          loopAgain = true;
        } else {
          const lastBracket = this.buffer.lastIndexOf('<');
          if (lastBracket === -1) {
            process.stdout.write(this.buffer);
            this.buffer = '';
          } else {
            process.stdout.write(this.buffer.substring(0, lastBracket));
            this.buffer = this.buffer.substring(lastBracket);
          }
        }
      } else { // isInsideCommand
        const endTag = `</${this.currentCommand}>`;
        if (this.buffer.includes(endTag)) {
          const endTagIndex = this.buffer.indexOf(endTag) + endTag.length;
          const commandText = this.buffer.substring(0, endTagIndex);
          process.stdout.write(commandText);

          this.buffer = this.buffer.substring(endTagIndex);

          this.isInsideCommand = false;
          this.currentCommand = '';
          process.stdout.write(RESET_COLOR);
          loopAgain = true;
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
