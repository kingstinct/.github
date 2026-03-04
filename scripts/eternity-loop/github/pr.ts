import type { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

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
}

const BOT_COMMENT_PREFIX = "🤖 **eternity-loop bot:**";
const BOT_USERS = ["copilot", "github-actions[bot]"];

function isBot(author: string, body: string): boolean {
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

export async function getPrComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  cutoffDate?: string,
): Promise<{ all: PrComment[]; new: PrComment[]; previous: PrComment[] }> {
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
      if (isBot(author, comment.body)) continue;
      comments.push({
        id: comment.databaseId,
        author,
        body: comment.body,
        createdAt: comment.createdAt,
        type: "review_thread",
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
    if (isBot(author, comment.body ?? "")) continue;
    comments.push({
      id: comment.id,
      author,
      body: comment.body ?? "",
      createdAt: comment.created_at,
      type: "issue_comment",
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
    if (isBot(author, review.body)) continue;
    comments.push({
      id: review.id,
      author,
      body: review.body,
      createdAt: review.submitted_at ?? "",
      type: "review_body",
    });
  }

  // Split by cutoff date
  if (cutoffDate) {
    const cutoff = new Date(cutoffDate);
    const newComments = comments.filter((c) => new Date(c.createdAt) > cutoff);
    const previousComments = comments.filter((c) => new Date(c.createdAt) <= cutoff);
    return { all: comments, new: newComments, previous: previousComments };
  }

  return { all: comments, new: comments, previous: [] };
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
