import type { Workflow } from "./types";
import type { IssueProvider } from "../providers/types";
import type { Issue, WorkflowContext } from "../types";
import { log, logDebug, logWorkflow, logPrdEntryCount } from "../logger";
import { ensureMainBranch, checkoutBranch, pushBranch } from "../git";
import { createGitHubClient, getRepoInfo } from "../github/client";
import { createPr, postPrComment } from "../github/pr";
import { readPrompt } from "../prompts";
import { ClaudeCliRunner } from "../ai-runner";
import { join } from "node:path";

export class NewFeatureWorkflow implements Workflow {
  name = "new-feature";
  priority = 3;

  async check(ctx: WorkflowContext, provider: IssueProvider): Promise<Issue | null> {
    logDebug("[new-feature] Checking for Todo issues with prd label...");

    const issues = await provider.queryIssues({
      teamId: ctx.settings.teamId,
      projectId: ctx.settings.projectId,
      stateName: "Todo",
      labels: ["prd"],
    });

    const count = issues.length;
    if (count === 0) {
      logDebug(`[new-feature] Found 0 Todo issues to implement`);
      return null;
    }

    log(`[new-feature] Found ${count} Todo issues to implement`);
    log(`[new-feature] Found Todo issue: ${issues[0].identifier}`);
    return issues[0];
  }

  async prepare(ctx: WorkflowContext, issue: Issue): Promise<void> {
    log(`[new-feature] Preparing new feature workflow for ${issue.identifier}`);

    // Reset to main branch
    await ensureMainBranch(ctx.workDir);

    // Transition issue to In Progress
    const { LinearProvider } = await import("../providers/linear");
    const provider = new LinearProvider(process.env.LINEAR_API_KEY!);
    await provider.transitionIssue(issue.uuid, "In Progress");

    // Invoke AI runner with create-prd prompt
    const prompt = await readPrompt("create-prd.md");
    const runner = new ClaudeCliRunner();
    const fullPrompt = [
      prompt,
      `\n## Issue\n- Identifier: ${issue.identifier}\n- Title: ${issue.title}\n- Description: ${issue.description}\n- URL: ${issue.url}\n- Branch: ${issue.branchName}`,
      `\n## Instructions\nWrite prd.json to: ${ctx.ralphDir}/prd.json\nUse branch name: ${issue.branchName}\nUse project name: ${issue.identifier} - ${issue.title}`,
    ].join("\n");

    await runner.run(fullPrompt, ctx.workDir);

    // Log PRD entry count
    await logPrdEntryCount("new-feature", join(ctx.ralphDir, "prd.json"));

    // Create and checkout feature branch
    await checkoutBranch(ctx.workDir, issue.branchName);

    // Write CLAUDE.md from ralph-claude-md.md
    const claudeMdContent = await readPrompt("ralph-claude-md.md");
    await Bun.write(join(ctx.ralphDir, "CLAUDE.md"), claudeMdContent);

    log(`[new-feature] Prepared feature PRD for ${issue.identifier}`);
  }

  async finalize(ctx: WorkflowContext, issue: Issue, ralphExitCode: number): Promise<void> {
    log(`[new-feature] Finalizing new feature for ${issue.identifier} (exit: ${ralphExitCode})`);

    const octokit = createGitHubClient();
    const { owner, repo } = await getRepoInfo(ctx.workDir);

    // Push changes to origin
    await pushBranch(ctx.workDir, issue.branchName);

    if (ralphExitCode === 0) {
      // Create regular PR
      const pr = await createPr(octokit, owner, repo, {
        title: `${issue.identifier}: ${issue.title}`,
        body: `Resolves ${issue.identifier}\n\n${issue.url}\n\nImplemented by eternity-loop agent.`,
        head: issue.branchName,
        draft: false,
      });

      // Post progress.txt as PR comment
      const progressFile = join(ctx.ralphDir, "progress.txt");
      const progress = await Bun.file(progressFile).text();
      await postPrComment(
        octokit, owner, repo, pr.number,
        `🤖 **eternity-loop bot:** Feature implementation complete.\n\n<details><summary>Progress log</summary>\n\n${progress}\n\n</details>`,
      );

      log(`[new-feature] Created PR ${pr.url}`);
    } else {
      // Create draft PR via AI runner
      const runner = new ClaudeCliRunner();
      const prPrompt = await readPrompt("create-pr.md");
      const fullPrompt = [
        prPrompt,
        `\n## Issue\n- Identifier: ${issue.identifier}\n- Title: ${issue.title}\n- URL: ${issue.url}\n- Branch: ${issue.branchName}`,
        `\nCreate this as a DRAFT PR since the agent did not complete all tasks.`,
      ].join("\n");

      await runner.run(fullPrompt, ctx.workDir);

      log(`[new-feature] Created draft PR for ${issue.identifier}`);
    }
  }
}
