import { $ } from "bun";

export interface AiRunner {
  run(prompt: string, workDir: string): Promise<string>;
}

export class ClaudeCliRunner implements AiRunner {
  async run(prompt: string, workDir: string): Promise<string> {
    const result = await $`claude --dangerously-skip-permissions --print -p ${prompt}`
      .cwd(workDir)
      .text();
    return result;
  }
}
