import { Octokit } from "@octokit/rest";

export function createGitHubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is not set");
  }
  return new Octokit({ auth: token });
}

export async function getRepoInfo(workDir?: string): Promise<{ owner: string; repo: string }> {
  const args = workDir ? ["-C", workDir] : [];
  const result = await Bun.$`git ${args} remote get-url origin`.text();
  const url = result.trim();

  // Handle both HTTPS and SSH URLs
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Could not parse GitHub owner/repo from remote URL: ${url}`);
  }

  return { owner: match[1], repo: match[2] };
}
