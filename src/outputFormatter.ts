const THINKING_COLOR = '\x1b[90m'; // Dark grey for thinking messages
const TOOL_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

export class StreamOutputFormatter {
  private buffer: string = '';
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

  public writeToolCall(functionName: string, args: string): void {
    this.stopThinking();
    this.startToolCall();
  }
  
  private startToolCall() {
    if (!this.isToolCall) {
      this.flush();
      process.stdout.write(TOOL_COLOR + '\nTool call...');
      this.isToolCall = true;
    }
  }

  private stopToolCall() {
    if (this.isToolCall) {
      process.stdout.write(RESET_COLOR); //TODO: show then call
      this.isToolCall = false;
    }
  }

  public writeContent(chunk: string): void {
    this.stopThinking();
    this.stopToolCall();

    this.buffer += chunk;
    process.stdout.write(this.buffer); // Directly write the buffer
    this.buffer = ''; // Clear the buffer after writing
  }

  public flush(): void {
    if (this.buffer) {
      process.stdout.write(this.buffer);
      this.buffer = '';
    }
    this.stopThinking();
    this.stopToolCall();
  }
}
