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
  // Try checking out existing branch first, create from remote if available
  try {
    await $`git -C ${workDir} checkout ${branch}`.quiet();
  } catch {
    try {
      await $`git -C ${workDir} checkout -b ${branch} origin/${branch}`.quiet();
    } catch {
      await $`git -C ${workDir} checkout -b ${branch}`;
    }
  }
}

export async function pushBranch(workDir: string, branch?: string): Promise<void> {
  const branchName = branch ?? await getCurrentBranch(workDir);
  await $`git -C ${workDir} push -u origin ${branchName}`;
}

export async function getCurrentBranch(workDir: string): Promise<string> {
  const result = await $`git -C ${workDir} branch --show-current`.text();
  return result.trim();
}

export async function getLatestCommitDate(workDir: string, branch?: string): Promise<string> {
  const ref = branch ? `origin/${branch}` : "HEAD";
  const result = await $`git -C ${workDir} log -1 --format=%ad --date=format-local:%Y-%m-%dT%H:%M:%SZ ${ref}`.text();
  return result.trim();
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
