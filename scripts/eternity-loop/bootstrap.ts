import { $ } from "bun";
import { dirname, join } from "node:path";
import { startSpinner } from "./logger";

export function isInsideSession(): boolean {
  return process.env.ETERNITY_LOOP_INSIDE === "1";
}

export async function cleanupWorktree(): Promise<void> {
  const worktreePath = process.env.ETERNITY_LOOP_WORKTREE;
  const repoRoot = process.env.ETERNITY_LOOP_REPO_ROOT;
  if (!worktreePath || !repoRoot) return;

  try {
    await $`git -C ${repoRoot} worktree remove --force ${worktreePath}`.quiet();
  } catch {
    // Worktree may already be gone
  }
}

export async function bootstrap(args: string[]): Promise<void> {
  const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
  const projectName = repoRoot.split("/").pop() ?? "unknown";
  const tmuxSession = `eternity-loop-${projectName}`;
  const worktreePath = join(repoRoot, ".claude/worktrees/eternity-loop");
  const scriptPath = join(dirname(import.meta.path), "index.ts");

  const spinner = startSpinner("Starting up...");

  // Kill existing tmux session if running
  try {
    await $`tmux has-session -t ${tmuxSession}`.quiet();
    await $`tmux kill-session -t ${tmuxSession}`.quiet();
  } catch {
    // No existing session
  }

  // Remove existing worktree
  try {
    await $`git -C ${repoRoot} worktree remove --force --force ${worktreePath}`.quiet();
  } catch {
    // Continue with hard cleanup below.
  }

  // Clear stale worktree metadata and path left by interrupted runs.
  try {
    await $`git -C ${repoRoot} worktree prune --expire now`.quiet();
  } catch {
    // Best effort
  }

  try {
    await $`rm -rf ${worktreePath}`.quiet();
  } catch {
    // Already gone
  }

  // Create fresh worktree detached on origin/main
  await $`mkdir -p ${dirname(worktreePath)}`;
  await $`git -C ${repoRoot} fetch origin`.quiet();

  let mainRef = "origin/main";
  try {
    await $`git -C ${repoRoot} rev-parse --verify origin/main`.quiet();
  } catch {
    mainRef = "origin/master";
  }

  await $`git -C ${repoRoot} worktree add --force ${worktreePath} --detach ${mainRef}`;

  spinner.stop();

  // Build the command to run inside tmux
  const argsStr = args.join(" ");
  const envVars = [
    `ETERNITY_LOOP_INSIDE=1`,
    `ETERNITY_LOOP_WORKTREE='${worktreePath}'`,
    `ETERNITY_LOOP_REPO_ROOT='${repoRoot}'`,
    `LINEAR_API_KEY='${process.env.LINEAR_API_KEY ?? ""}'`,
  ].join(" ");

  const cmd = `cd '${worktreePath}' && ${envVars} bun '${scriptPath}' ${argsStr}; echo 'Eternity loop exited. Press enter to close.'; read`;

  // Launch new tmux session
  const proc = Bun.spawn(["tmux", "new-session", "-s", tmuxSession, cmd], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  await proc.exited;
}
