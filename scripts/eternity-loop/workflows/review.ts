import type { Workflow } from "./types";
import type { IssueProvider } from "../providers/types";
import type { Issue, WorkflowContext } from "../types";
import { logDebug, logWorkflow, logPrdEntryCount } from "../logger";
import { checkoutBranch, pushBranch, getLatestCommitDate } from "../git";
import { createGitHubClient, getRepoInfo } from "../github/client";
import { findPrByBranch, getPrComments, postPrComment, checkForNewHumanComments, countWorkflowRunsSinceLastHumanInteraction, uploadProgressScreenshots } from "../github/pr";
import { readPrompt } from "../prompts";
import { ClaudeCliRunner } from "../ai-runner";
import { join } from "node:path";

export class ReviewWorkflow implements Workflow {
  name = "review";
  priority = 1;

  async check(ctx: WorkflowContext, provider: IssueProvider): Promise<Issue | null> {
    logDebug("[review] Checking for issues needing review attention...");

    // Query for In Review issues with prd label
    const inReview = await provider.queryIssues({
      teamId: ctx.settings.teamId,
      projectId: ctx.settings.projectId,
      stateName: "In Review",
      labels: ["prd"],
    });

    // Also check In Progress issues with prd label
    const inProgress = await provider.queryIssues({
      teamId: ctx.settings.teamId,
      projectId: ctx.settings.projectId,
      stateName: "In Progress",
      labels: ["prd"],
    });

    const candidates = [...inReview, ...inProgress];
    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    let commentCount = 0;
    for (const issue of candidates) {
      const pr = await findPrByBranch(octokit, owner, repo, issue.branchName);
      if (!pr) continue;

      const latestCommitDate = await getLatestCommitDate(ctx.workDir, issue.branchName);
      const hasNewComments = await checkForNewHumanComments(
        octokit, owner, repo, pr.number, latestCommitDate,
      );

      if (hasNewComments) {
        // Check if we've already hit the attempt limit since last human interaction
        const runs = await countWorkflowRunsSinceLastHumanInteraction(
          octokit, owner, repo, pr.number, "Review changes applied.",
        );
        if (runs >= 3) {
          logDebug(`[review] Skipping ${issue.identifier}: reached 3 review attempts since last human interaction`);
          continue;
        }

        commentCount++;
        logWorkflow("review", `[review] Found issue ${issue.identifier} with new PR comments`);
        issue.prNumber = pr.number;
        return issue;
      }
    }

    if (commentCount === 0) {
      logDebug(`[review] Found 0 issues with new PR comments`);
    }

    return null;
  }

  async prepare(ctx: WorkflowContext, issue: Issue): Promise<void> {
    logWorkflow("review", `[review] Preparing review workflow for ${issue.identifier}`);

    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    // Check out the issue branch
    await checkoutBranch(ctx.workDir, issue.branchName);

    // Collect PR comments split by cutoff date
    const latestCommitDate = await getLatestCommitDate(ctx.workDir, issue.branchName);
    const comments = await getPrComments(
      octokit, owner, repo, issue.prNumber!, latestCommitDate,
    );

    const newCommentsText = comments.new
      .map((c) => `**${c.author}** (${c.type}):\n${c.body}`)
      .join("\n\n---\n\n");

    const previousCommentsText = comments.previous
      .map((c) => `**${c.author}** (${c.type}):\n${c.body}`)
      .join("\n\n---\n\n");

    // Invoke AI runner with create-review-prd prompt
    const prompt = await readPrompt("create-review-prd.md");
    const runner = new ClaudeCliRunner();
    const fullPrompt = [
      prompt,
      `\n## Issue\n- Identifier: ${issue.identifier}\n- Title: ${issue.title}\n- Branch: ${issue.branchName}\n- PR #${issue.prNumber}`,
      `\n## New Comments (after latest commit)\n${newCommentsText || "(none)"}`,
      `\n## Previous Comments\n${previousCommentsText || "(none)"}`,
      `\n## Instructions\nWrite prd.json to: ${ctx.ralphDir}/prd.json\nUse branch name: ${issue.branchName}\nUse project name: ${issue.identifier} - ${issue.title} (Review)`,
    ].join("\n");

    await runner.run(fullPrompt, ctx.workDir);

    // Log PRD entry count
    await logPrdEntryCount("review", join(ctx.ralphDir, "prd.json"));

    // Write CLAUDE.md from ralph-claude-md.md
    const claudeMdContent = await readPrompt("ralph-claude-md.md");
    await Bun.write(join(ctx.ralphDir, "CLAUDE.md"), claudeMdContent);

    logWorkflow("review", `[review] Prepared review PRD for ${issue.identifier}`);
  }

  async finalize(ctx: WorkflowContext, issue: Issue, ralphExitCode: number): Promise<void> {
    logWorkflow("review", `[review] Finalizing review workflow for ${issue.identifier} (exit: ${ralphExitCode})`);

    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    // Push changes to origin
    await pushBranch(ctx.workDir, issue.branchName);

    // Reply to PR comments via AI runner
    const replyPrompt = await readPrompt("reply-to-pr-comments.md");
    const runner = new ClaudeCliRunner();
    const fullReplyPrompt = [
      replyPrompt,
      `\n## Context\n- Repository: ${owner}/${repo}\n- PR #${issue.prNumber}\n- Branch: ${issue.branchName}`,
    ].join("\n");

    await runner.run(fullReplyPrompt, ctx.workDir);

    // Post progress.txt as PR comment
    const progressFile = join(ctx.ralphDir, "progress.txt");
    const progress = await Bun.file(progressFile).text();
    await postPrComment(
      octokit, owner, repo, issue.prNumber!,
      `🤖 **eternity-loop bot:** Review changes applied.\n\n<details><summary>Progress log</summary>\n\n${progress}\n\n</details>`,
    );

    // Upload screenshots referenced in progress.txt
    await uploadProgressScreenshots(octokit, owner, repo, issue.prNumber!, progress, ctx.workDir, issue.branchName);

    logWorkflow("review", `[review] Finalized review for ${issue.identifier} — https://github.com/${owner}/${repo}/pull/${issue.prNumber}`);
  }
}
