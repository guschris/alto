const THINKING_COLOR = '\x1b[90m'; // Dark grey for thinking messages
const TOOL_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

export class StreamOutputFormatter {
  private toolBuffer: string = '';
  private isStreamingThinking: boolean = false;
  private isToolCall: boolean = false;

  constructor() {
    // Ensure initial state is clean
    process.stdout.write(RESET_COLOR);
  }

  public writeThinking(chunk: string): void {
    this.startThinking();
    process.stdout.write(chunk);
  }

  private startThinking() {
    if (!this.isStreamingThinking) {
      this.flush(); // Flush any pending content before switching mode
      process.stdout.write(THINKING_COLOR + 'THINKING: ');
      this.isStreamingThinking = true;
    }
  }

  private stopThinking() {
    if (this.isStreamingThinking) {
      process.stdout.write(RESET_COLOR + '\n');
      this.isStreamingThinking = false;
    }
  }

  public writeToolCall(chunk: string): void {
    this.stopThinking();
    this.startToolCall();
    this.toolBuffer += chunk;
  }
  
  private startToolCall() {
    if (!this.isToolCall) {
      this.flush();
      process.stdout.write(TOOL_COLOR + '\nShell: ');
      this.isToolCall = true;
      this.toolBuffer = '';
    }
  }

  private stopToolCall() {
    if (this.isToolCall) {
      try {
        //Note: this works whilst we have command line tool calls ONLY
        const tc = JSON.parse(this.toolBuffer);
        process.stdout.write((tc?.command ?? '') + RESET_COLOR);
      } catch (error) {
        process.stdout.write(RESET_COLOR);
      }      
      this.isToolCall = false;
    }
  }

  public writeContent(chunk: string): void {
    this.stopThinking();
    this.stopToolCall();
    process.stdout.write(chunk);
  }

  public flush(): void {
    this.stopThinking();
    this.stopToolCall();
  }
}
