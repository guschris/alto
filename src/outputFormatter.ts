const THINKING_COLOR = '\x1b[90m'; // Dark grey for thinking messages
const RESET_COLOR = '\x1b[0m';

export class StreamOutputFormatter {
  private buffer: string = '';
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
    process.stdout.write(this.buffer); // Directly write the buffer
    this.buffer = ''; // Clear the buffer after writing
  }

  public flush(): void {
    if (this.buffer) {
      process.stdout.write(this.buffer);
      this.buffer = '';
    }
    if (this.isStreamingThinking) {
      process.stdout.write(RESET_COLOR);
      this.isStreamingThinking = false;
    }
  }
}
