import type { Workflow } from "./types";
import type { IssueProvider } from "../providers/types";
import type { Issue, WorkflowContext } from "../types";
import { logDebug, logWorkflow, logPrdEntryCount } from "../logger";
import { checkoutBranch, pushBranch, getHeadSha } from "../git";
import { createGitHubClient, getRepoInfo } from "../github/client";
import { findPrByBranch, postPrComment, uploadProgressScreenshots } from "../github/pr";
import { checkPrHasCiFailures, getCiFailureDetails, recordFixedSha } from "../github/ci";
import { readPrompt } from "../prompts";
import { ClaudeCliRunner } from "../ai-runner";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export class CiFixWorkflow implements Workflow {
  name = "ci-fix";
  priority = 2;

  async check(ctx: WorkflowContext, provider: IssueProvider): Promise<Issue | null> {
    logDebug("[ci-fix] Checking for CI failures...");

    const inReview = await provider.queryIssues({
      teamId: ctx.settings.teamId,
      projectId: ctx.settings.projectId,
      stateName: "In Review",
      labels: ["prd"],
    });

    const inProgress = await provider.queryIssues({
      teamId: ctx.settings.teamId,
      projectId: ctx.settings.projectId,
      stateName: "In Progress",
      labels: ["prd"],
    });

    const candidates = [...inReview, ...inProgress];
    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    const settingsDir = join(ctx.workDir, ".eternity-loop");

    let failureCount = 0;
    for (const issue of candidates) {
      const pr = await findPrByBranch(octokit, owner, repo, issue.branchName);
      if (!pr) continue;

      const hasCiFailures = await checkPrHasCiFailures(
        octokit, owner, repo, issue.branchName, settingsDir, pr.number,
      );

      if (hasCiFailures) {
        failureCount++;
        logWorkflow("ci-fix", `[ci-fix] Found CI failures for ${issue.identifier} (PR #${pr.number})`);
        issue.prNumber = pr.number;
        return issue;
      }
    }

    if (failureCount === 0) {
      logDebug(`[ci-fix] Found 0 CI failures`);
    }

    return null;
  }

  async prepare(ctx: WorkflowContext, issue: Issue): Promise<void> {
    logWorkflow("ci-fix", `[ci-fix] Preparing CI fix workflow for ${issue.identifier}`);

    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    // Collect CI failure details
    const ciDetails = await getCiFailureDetails(
      octokit, owner, repo, issue.prNumber!, issue.branchName,
    );

    // Check out the issue branch
    await checkoutBranch(ctx.workDir, issue.branchName);

    // Record SHA to prevent re-processing same commit
    const settingsDir = join(ctx.workDir, ".eternity-loop");
    await mkdir(settingsDir, { recursive: true });

    const headSha = await getHeadSha(ctx.workDir, `origin/${issue.branchName}`);
    await recordFixedSha(settingsDir, headSha);

    // Invoke AI runner with create-ci-fix-prd prompt
    const prompt = await readPrompt("create-ci-fix-prd.md");
    const runner = new ClaudeCliRunner();
    const fullPrompt = [
      prompt,
      `\n## Issue\n- Identifier: ${issue.identifier}\n- Title: ${issue.title}\n- Branch: ${issue.branchName}\n- PR #${issue.prNumber}`,
      `\n## CI Failure Details\n${ciDetails}`,
      `\n## Instructions\nWrite prd.json to: ${ctx.ralphDir}/prd.json\nUse branch name: ${issue.branchName}\nUse project name: ${issue.identifier} - CI Fix`,
    ].join("\n");

    await runner.run(fullPrompt, ctx.workDir);

    // Log PRD entry count
    await logPrdEntryCount("ci-fix", join(ctx.ralphDir, "prd.json"));

    // Write CLAUDE.md: standard ralph-claude-md.md + CI failure context appended
    const claudeMdContent = await readPrompt("ralph-claude-md.md");
    const ciClaudeMd = [
      claudeMdContent,
      "\n\n## CI Failure Context\n",
      ciDetails,
    ].join("");
    await Bun.write(join(ctx.ralphDir, "CLAUDE.md"), ciClaudeMd);

    logWorkflow("ci-fix", `[ci-fix] Prepared CI fix PRD for ${issue.identifier}`);
  }

  async finalize(ctx: WorkflowContext, issue: Issue, ralphExitCode: number): Promise<void> {
    logWorkflow("ci-fix", `[ci-fix] Finalizing CI fix for ${issue.identifier} (exit: ${ralphExitCode})`);

    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    // Push changes to origin
    await pushBranch(ctx.workDir, issue.branchName);

    // Post progress.txt as PR comment
    const progressFile = join(ctx.ralphDir, "progress.txt");
    const progress = await Bun.file(progressFile).text();
    await postPrComment(
      octokit, owner, repo, issue.prNumber!,
      `🤖 **eternity-loop bot:** CI fix applied.\n\n<details><summary>Progress log</summary>\n\n${progress}\n\n</details>`,
    );

    // Upload screenshots referenced in progress.txt
    await uploadProgressScreenshots(octokit, owner, repo, issue.prNumber!, progress, ctx.workDir, issue.branchName);

    logWorkflow("ci-fix", `[ci-fix] Finalized CI fix for ${issue.identifier} — https://github.com/${owner}/${repo}/pull/${issue.prNumber}`);
  }
}
