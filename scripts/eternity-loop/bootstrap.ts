import { $ } from "bun";
import { dirname, join } from "node:path";

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

  // Kill existing tmux session if running
  try {
    await $`tmux has-session -t ${tmuxSession}`.quiet();
    await $`tmux kill-session -t ${tmuxSession}`.quiet();
  } catch {
    // No existing session
  }

  // Remove existing worktree
  try {
    await $`git worktree remove --force ${worktreePath}`.quiet();
  } catch {
    try {
      await $`rm -rf ${worktreePath}`.quiet();
    } catch {
      // Already gone
    }
  }

  // Create fresh worktree detached on origin/main
  await $`mkdir -p ${dirname(worktreePath)}`;
  await $`git fetch origin`.quiet();

  let mainRef = "origin/main";
  try {
    await $`git rev-parse --verify origin/main`.quiet();
  } catch {
    mainRef = "origin/master";
  }

  await $`git worktree add ${worktreePath} --detach ${mainRef}`;

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
