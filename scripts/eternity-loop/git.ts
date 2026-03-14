import { $ } from "bun";

export async function cleanWorkingTree(workDir: string): Promise<void> {
  await $`git -C ${workDir} checkout -- .`;
  await $`git -C ${workDir} clean -fd`;
}

export async function ensureMainBranch(workDir: string): Promise<void> {
  await $`git -C ${workDir} fetch origin`;

  // Try origin/main first, fall back to origin/master
  const mainRef = await $`git -C ${workDir} rev-parse --verify origin/main`
    .quiet()
    .then(() => "origin/main")
    .catch(() => "origin/master");

  await $`git -C ${workDir} checkout --detach ${mainRef}`;
  await cleanWorkingTree(workDir);
}

export async function checkoutBranch(workDir: string, branch: string): Promise<void> {
  await $`git -C ${workDir} fetch origin`.quiet();

  // Force-create (or reset) the local branch to match the remote, then check it out.
  // Using -B avoids errors when the branch already exists (e.g. checked out in another worktree).
  try {
    await $`git -C ${workDir} checkout -B ${branch} origin/${branch}`.quiet();
  } catch {
    // Remote branch doesn't exist yet — create a new local branch
    await $`git -C ${workDir} checkout -B ${branch}`.quiet();
  }
}

export async function pushBranch(workDir: string, branch?: string): Promise<void> {
  const branchName = branch ?? await getCurrentBranch(workDir);
  await $`git -C ${workDir} push -u origin ${branchName} --no-verify`;
}

export async function getCurrentBranch(workDir: string): Promise<string> {
  const result = await $`git -C ${workDir} branch --show-current`.text();
  return result.trim();
}

export async function getLatestCommitDate(workDir: string, branch?: string): Promise<string> {
  const ref = branch ? `origin/${branch}` : "HEAD";
  const result = await $`git -C ${workDir} log -1 --format=%ct ${ref}`.text();
  const epochSeconds = Number.parseInt(result.trim(), 10);
  return new Date(epochSeconds * 1000).toISOString();
}

export async function getLatestCommitMessage(workDir: string, branch?: string): Promise<string> {
  const ref = branch ? `origin/${branch}` : "HEAD";
  const result = await $`git -C ${workDir} log -1 --format=%s ${ref}`.text();
  return result.trim();
}

export async function getHeadSha(workDir: string, ref?: string): Promise<string> {
  const target = ref ?? "HEAD";
  const result = await $`git -C ${workDir} rev-parse ${target}`.text();
  return result.trim();
}
