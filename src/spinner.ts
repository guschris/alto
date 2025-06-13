// src/spinner.ts

class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private spinnerChars: string[];
  private spinnerIndex: number = 0;
  private message: string;

  private static readonly DEFAULT_SPINNER_CHARS: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static readonly DEFAULT_MESSAGES: string[] = [
    'Alto is processing your prompt...',
    'Alto is analyzing the prompt...',
    'Alto is understanding your request...',
    'Alto is interpreting the prompt...',
  ];

  constructor(chars?: string[]) {
    this.spinnerChars = chars || Spinner.DEFAULT_SPINNER_CHARS;
    this.message = ''; // Will be set in start method
  }

  start(message?: string) {
    if (this.interval) return; // Spinner already running

    this.message = message || Spinner.DEFAULT_MESSAGES[Math.floor(Math.random() * Spinner.DEFAULT_MESSAGES.length)];
    process.stdout.write('\x1b[?25l'); // Hide cursor
    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.spinnerChars[this.spinnerIndex++]} ${this.message}`);
      this.spinnerIndex = this.spinnerIndex % this.spinnerChars.length;
    }, 100);
  }

  stop(clearLine: boolean = true) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      if (clearLine) {
        process.stdout.write('\r\x1b[K'); // Clear the line
      }
      process.stdout.write('\x1b[?25h'); // Show cursor
    }
  }
}

export default Spinner;
