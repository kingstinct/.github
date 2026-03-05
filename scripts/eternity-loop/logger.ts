import { join } from "node:path";

// ANSI color codes
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";

const WORKFLOW_COLORS: Record<string, string> = {
  "new-feature": GREEN,
  "ci-fix": YELLOW,
  "review": MAGENTA,
};

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
}

export function log(...args: unknown[]): void {
  console.log(timestamp(), ...args);
}

export function logErr(...args: unknown[]): void {
  console.error(timestamp(), ...args);
}

export function logDebug(...args: unknown[]): void {
  console.log(`${DIM}${timestamp()}`, ...args, RESET);
}

export function logWorkflow(workflowName: string, ...args: unknown[]): void {
  const color = WORKFLOW_COLORS[workflowName] ?? "";
  console.log(`${color}${timestamp()}`, ...args, RESET);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function startSpinner(message: string): { stop: () => void } {
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${DIM}${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}${RESET}`);
  }, 80);

  return {
    stop() {
      clearInterval(interval);
      process.stdout.write("\r\x1b[K"); // clear line
    },
  };
}

export async function logPrdEntryCount(workflowName: string, prdPath: string): Promise<void> {
  try {
    const file = Bun.file(prdPath);
    if (!(await file.exists())) return;
    const prd = await file.json();
    const count = Array.isArray(prd.userStories) ? prd.userStories.length : 0;
    logWorkflow(workflowName, `[${workflowName}] Generated prd.json with ${count} user stories`);
  } catch {
    // Non-critical, skip if prd.json can't be read
  }
}
