import { $ } from "bun";
import { log, startSpinner } from "./logger";

export interface AiRunner {
  run(prompt: string, workDir: string): Promise<string>;
}

export class ClaudeCliRunner implements AiRunner {
  async run(prompt: string, workDir: string): Promise<string> {
    log("[claude] Running Claude, this could take a while...");
    const spinner = startSpinner("Claude is thinking...");
    try {
      const result = await $`claude --dangerously-skip-permissions --print -p ${prompt}`
        .cwd(workDir)
        .text();
      return result;
    } finally {
      spinner.stop();
    }
  }
}
