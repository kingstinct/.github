import type { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { join, basename } from "node:path";

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

export interface PrComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  type: "review_thread" | "issue_comment" | "review_body";
  isBot: boolean;
}

const BOT_COMMENT_PREFIX = "🤖 **eternity-loop bot:**";
const BOT_USERS = ["copilot", "github-actions[bot]"];

function checkIsBot(author: string, body: string): boolean {
  return BOT_USERS.includes(author) || body.startsWith(BOT_COMMENT_PREFIX);
}

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{
          isResolved: boolean;
          isOutdated: boolean;
          comments: {
            nodes: Array<{
              id: string;
              databaseId: number;
              author: { login: string } | null;
              body: string;
              createdAt: string;
            }>;
          };
        }>;
      };
    };
  };
}

/**
 * Fetch all PR comments (human and bot) from review threads, issue comments,
 * and review bodies. Each comment is tagged with `isBot`.
 */
export async function fetchAllPrComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrComment[]> {
  const token = process.env.GITHUB_TOKEN;
  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

  // 1. Review threads via GraphQL (unresolved, non-outdated only)
  const threadData = await gql<ReviewThreadsResponse>(
    `query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              isOutdated
              comments(first: 100) {
                nodes {
                  id
                  databaseId
                  author { login }
                  body
                  createdAt
                }
              }
            }
          }
        }
      }
    }`,
    { owner, repo, prNumber },
  );

  const comments: PrComment[] = [];

  for (const thread of threadData.repository.pullRequest.reviewThreads.nodes) {
    if (thread.isResolved || thread.isOutdated) continue;
    for (const comment of thread.comments.nodes) {
      const author = comment.author?.login ?? "unknown";
      comments.push({
        id: comment.databaseId,
        author,
        body: comment.body,
        createdAt: comment.createdAt,
        type: "review_thread",
        isBot: checkIsBot(author, comment.body),
      });
    }
  }

  // 2. Issue comments via REST
  const { data: issueComments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  for (const comment of issueComments) {
    const author = comment.user?.login ?? "unknown";
    const body = comment.body ?? "";
    comments.push({
      id: comment.id,
      author,
      body,
      createdAt: comment.created_at,
      type: "issue_comment",
      isBot: checkIsBot(author, body),
    });
  }

  // 3. Review bodies via REST
  const { data: reviews } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  for (const review of reviews) {
    if (!review.body) continue;
    const author = review.user?.login ?? "unknown";
    comments.push({
      id: review.id,
      author,
      body: review.body,
      createdAt: review.submitted_at ?? "",
      type: "review_body",
      isBot: checkIsBot(author, review.body),
    });
  }

  return comments;
}

export async function getPrComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  cutoffDate?: string,
): Promise<{ all: PrComment[]; new: PrComment[]; previous: PrComment[] }> {
  const allComments = await fetchAllPrComments(octokit, owner, repo, prNumber);
  const humanComments = allComments.filter((c) => !c.isBot);

  if (cutoffDate) {
    const cutoff = new Date(cutoffDate);
    const newComments = humanComments.filter((c) => new Date(c.createdAt) > cutoff);
    const previousComments = humanComments.filter((c) => new Date(c.createdAt) <= cutoff);
    return { all: humanComments, new: newComments, previous: previousComments };
  }

  return { all: humanComments, new: humanComments, previous: [] };
}

export async function checkForNewHumanComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  latestCommitDate: string,
): Promise<boolean> {
  const { new: newComments } = await getPrComments(octokit, owner, repo, prNumber, latestCommitDate);
  return newComments.length > 0;
}

/**
 * Count how many times a specific workflow has run since the last human
 * interaction on a PR. Counts bot comments matching the workflow marker.
 * For PRs with no human interaction, counts from the beginning.
 */
export async function countWorkflowRunsSinceLastHumanInteraction(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  workflowMarker: string,
): Promise<number> {
  const allComments = await fetchAllPrComments(octokit, owner, repo, prNumber);

  // Find latest human interaction date
  const humanComments = allComments.filter((c) => !c.isBot);
  let latestHumanDate: Date | null = null;
  for (const c of humanComments) {
    const d = new Date(c.createdAt);
    if (!latestHumanDate || d > latestHumanDate) {
      latestHumanDate = d;
    }
  }
  const cutoff = latestHumanDate ?? new Date(0);

  // Count bot comments matching the workflow marker since cutoff
  return allComments.filter((c) =>
    c.isBot &&
    c.body.includes(workflowMarker) &&
    new Date(c.createdAt) > cutoff
  ).length;
}

/**
 * Extract screenshot file paths referenced in progress.txt content.
 * Looks for image file paths (relative or absolute) in the text.
 */
export function extractScreenshotPaths(progressContent: string, workDir: string): string[] {
  const paths: string[] = [];

  // Match file paths ending in image extensions
  // Handles: ./path/to/file.png, path/to/file.png, /absolute/path/file.png
  // Also handles paths in markdown image syntax: ![alt](path.png)
  const pathPattern = /(?:!\[[^\]]*\]\()?([^\s\n\r"'()]+\.(?:png|jpg|jpeg|gif|webp|svg))(?:\))?/gi;

  for (const match of progressContent.matchAll(pathPattern)) {
    const filePath = match[1];
    if (!filePath) continue;

    // Resolve relative paths against workDir
    const resolved = filePath.startsWith("/") ? filePath : join(workDir, filePath);
    if (!paths.includes(resolved)) {
      paths.push(resolved);
    }
  }

  return paths;
}

/**
 * Get the relative path of a file within a git repo.
 */
async function getRelativePath(workDir: string, absolutePath: string): Promise<string> {
  // If path is already relative (starts within workDir), extract relative portion
  if (absolutePath.startsWith(workDir)) {
    return absolutePath.slice(workDir.length).replace(/^\//, "");
  }
  // Otherwise try git to resolve
  try {
    const result = await Bun.$`git -C ${workDir} ls-files --full-name ${absolutePath}`.text();
    return result.trim();
  } catch {
    return basename(absolutePath);
  }
}

/**
 * Upload screenshots referenced in progress.txt to the PR as a comment.
 * Screenshots that are committed to the branch are referenced via raw GitHub URLs.
 * Screenshots not yet tracked are committed first, then referenced.
 */
export async function uploadProgressScreenshots(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  progressContent: string,
  workDir: string,
  branch: string,
): Promise<void> {
  const screenshotPaths = extractScreenshotPaths(progressContent, workDir);
  if (screenshotPaths.length === 0) return;

  const imageEntries: Array<{ name: string; url: string }> = [];

  for (const filePath of screenshotPaths) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) continue;

    const relativePath = await getRelativePath(workDir, filePath);
    const name = basename(filePath);

    // Check if file is tracked in git
    try {
      await Bun.$`git -C ${workDir} ls-files --error-unmatch ${filePath}`.quiet();
    } catch {
      // File not tracked - add and commit it
      try {
        await Bun.$`git -C ${workDir} add ${filePath}`.quiet();
        await Bun.$`git -C ${workDir} commit -m ${"chore: add screenshot " + name}`.quiet();
      } catch {
        continue; // Skip if we can't commit
      }
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${relativePath}`;
    imageEntries.push({ name, url: rawUrl });
  }

  if (imageEntries.length === 0) return;

  const body = [
    `🤖 **eternity-loop bot:** Screenshots from this run:\n`,
    ...imageEntries.map((entry, i) =>
      `### Screenshot ${i + 1}\n![${entry.name}](${entry.url})\n`
    ),
  ].join("\n");

  await postPrComment(octokit, owner, repo, prNumber, body);
}
