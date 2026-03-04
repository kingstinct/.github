import type { Octokit } from "@octokit/rest";

export async function findPrByBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; title: string; url: string } | null> {
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: "open",
    per_page: 1,
  });
  if (prs.length === 0) return null;
  return { number: prs[0].number, title: prs[0].title, url: prs[0].html_url };
}

export async function findPrByTitle(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
): Promise<{ number: number; title: string; url: string } | null> {
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const match = prs.find((pr) => pr.title === title);
  if (!match) return null;
  return { number: match.number, title: match.title, url: match.html_url };
}

export async function createPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { title: string; body: string; head: string; base?: string; draft?: boolean },
): Promise<{ number: number; url: string }> {
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base ?? "main",
    draft: options.draft ?? false,
  });
  return { number: pr.number, url: pr.html_url };
}

export async function postPrComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

export async function replyToReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<void> {
  await octokit.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body,
  });
}
