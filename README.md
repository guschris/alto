# AI Pair Programming Assistant CLI

This is a command-line interface (CLI) tool designed to act as your **AI pair programming assistant**, leveraging OpenAI's API to provide an interactive and highly capable coding partner directly in your terminal. It's built to streamline your development workflow by collaborating on tasks, answering questions, executing commands, and managing context, just like a human pair programmer.

## Features

*   **Collaborative AI Chat**: Engage in a natural language conversation with an AI model that understands your coding context and assists in real-time.
*   **Multi-line Prompts for Complex Discussions**: Easily provide detailed queries, code snippets, or elaborate problem descriptions across multiple lines, facilitating deeper collaboration.
*   **Intelligent Command Execution**: The AI can autonomously read your code, search your folders, and update your files, as well as being able to execute safe CLI commands. This allows the AI to gather information, test hypotheses, and perform actions as part of your pair programming session.
*   **Contextual File Content Submission**: Seamlessly share the content of local files (e.g., markdown, text files, code snippets) with the AI, enabling it to understand your codebase and provide relevant assistance.
*   **Persistent Chat History**: Maintain a continuous conversation flow, allowing the AI to remember past interactions and build upon previous discussions.
*   **Dynamic System Prompt for Role-Playing**: Customize the AI's persona or expertise (e.g., "You are a senior TypeScript architect") to tailor its assistance to your specific needs.
*   **Model Listing**: List available AI models to choose the best "partner" for your task.

### Collaborative Interaction

Simply type your questions, problems, or instructions. The AI will respond, often by suggesting solutions, providing code, or even executing commands to help you.

```
AI Coding Assistant CLI
Type "/help" for available commands. Enter multi-line prompts and type "/go" to submit.
> I'm trying to debug a React component. Can you help me understand why this state isn't updating?
```

### Multi-line Prompts for Detailed Context

For complex problems or when providing extensive code, use multi-line input. Type your prompt across multiple lines, and to submit, type `/go` on a new line.

```
> Here's the component code:
>
> import React, { useState, useEffect } from 'react';
>
> function MyComponent() {
>   const [count, setCount] = useState(0);
>
>   useEffect(() => {
>     console.log('Count:', count);
>   }, []); // Missing dependency array
>
>   return (
>     <button onClick={() => setCount(count + 1)}>Increment</button>
>   );
> }
>
> export default MyComponent;
>
> Why is the useEffect not logging updates to 'count'?
> /go
```

### Commands for Enhanced Collaboration

The CLI supports several built-in commands that enhance the pair programming experience:

*   `/help`: Show all available commands.
*   `/exit`: End your pair programming session.
*   `/models`: List available AI models to switch your "partner."
*   `/clear`: Clear the current conversation history, starting a fresh session.
*   `/history`: Review the full transcript of your pair programming session.
*   `/system <prompt>`: Define the AI's role or expertise for the current session.
    *   Example: `/system You are a helpful Python programming assistant.`
*   `/<filename>`: Share the content of a file from the `scripts/` directory directly with the AI. Useful for providing context or instructions from pre-written files.
    *   Example: `/commit` (submits content from `scripts/commit.md`) creates a Git commit message from the changes in your working directory.
*   `/go`: Submits the accumulated multi-line prompt.

### AI's Autonomous Problem Solving

The AI is designed to act as an active pair programmer. When it needs information or needs to perform an action to assist you, it will:

*   **Analyze and Decide**: The AI will "think" about the problem, determine what information is missing, and decide which internal tools or external commands are necessary.
*   **Propose and Execute**: It will then propose and execute these commands directly in your terminal. This allows it to gather data (e.g., `git status`), run tests, or even apply fixes.
*   **Learn and Adapt**: By observing the output of executed commands, the AI can refine its understanding, answer its own questions, and adapt its strategy to help you more effectively.

**How this benefits you**:
This autonomous capability makes the AI a powerful pair programming partner by:
*   **Automating Context Gathering**: The AI can fetch relevant information (like file contents or Git status) without you manually providing it.
*   **Streamlining Debugging**: It can run diagnostic commands and analyze output to help pinpoint issues faster.
*   **Accelerating Development**: The AI can take initiative on routine tasks, allowing you to focus on complex logic and design.
*   **Providing Proactive Assistance**: It can anticipate needs and suggest actions, making the pair programming experience more dynamic and efficient.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/alto.git # Replace with actual repo URL
    cd alto
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure OpenAI API**:
    Create a `config.json` file in the root directory of the project with your OpenAI API key, base URL, and preferred model.
    Example `config.json`:
    ```json
    {
      "openai": {
        "apiKey": "YOUR_OPENAI_API_KEY",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o"
      }
    }
    ```
    Replace `"YOUR_OPENAI_API_KEY"` with your actual API key. You might need to adjust `baseUrl` and `model` based on your specific OpenAI setup or if you're using a compatible local LLM.

## Usage

To start your AI pair programming session:

```bash
npm run start
```

Once started, you will see the prompt: `AI Coding Assistant CLI`.

## Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests.
