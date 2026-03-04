#!/usr/bin/env bun

import { parseArgs } from "util";
import { isInsideSession, bootstrap, cleanupWorktree } from "./bootstrap";
import { loadSettings, saveSettings } from "./config";
import { log, logErr } from "./logger";
import { LinearProvider } from "./providers/linear";
import { ReviewWorkflow } from "./workflows/review";
import { CiFixWorkflow } from "./workflows/ci-fix";
import { NewFeatureWorkflow } from "./workflows/new-feature";
import { runRalph } from "./ralph";
import { loadSkillGuidelines } from "./prompts";
import { join, dirname } from "node:path";
import type { Settings, WorkflowContext } from "./types";
import type { Workflow } from "./workflows/types";

// Export env vars for child processes
process.env.DISABLE_PUSHOVER_NOTIFICATIONS = "true";
process.env.RALPH_LOOP = "true";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "max-iterations": { type: "string", default: "50" },
  },
  allowPositionals: true,
});

const maxIterations = parseInt(values["max-iterations"] ?? "50", 10);

// If not inside session, bootstrap into tmux
if (!isInsideSession()) {
  await bootstrap(process.argv.slice(2));
  process.exit(0);
}

// Register cleanup handlers
const cleanup = async () => {
  log("[loop] Cleaning up worktree...");
  await cleanupWorktree();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Determine working directory and repo root
const workDir = process.cwd();
const repoRoot = process.env.ETERNITY_LOOP_REPO_ROOT ?? workDir;

// Ensure settings
async function ensureSettings(provider: LinearProvider): Promise<Settings> {
  let settings = await loadSettings(repoRoot);
  if (settings) {
    log("[loop] Loaded existing settings");
    return settings;
  }

  log("[loop] No settings found, running interactive setup...");

  const { select } = await import("@inquirer/prompts");
  const teamsAndProjects = await provider.fetchTeamsAndProjects();

  let teamId: string;
  if (teamsAndProjects.length === 1) {
    teamId = teamsAndProjects[0].teamId;
    log(`[loop] Auto-selected team: ${teamsAndProjects[0].teamName}`);
  } else {
    teamId = await select({
      message: "Select a Linear team:",
      choices: teamsAndProjects.map((t) => ({ name: t.teamName, value: t.teamId })),
    });
  }

  const team = teamsAndProjects.find((t) => t.teamId === teamId)!;
  let projectId = "";
  if (team.projects.length > 0) {
    projectId = await select({
      message: "Select a project (or none):",
      choices: [
        { name: "(no project filter)", value: "" },
        ...team.projects.map((p) => ({ name: p.name, value: p.id })),
      ],
    });
  }

  settings = {
    teamId,
    projectId,
    workingDirectory: workDir,
  };

  await saveSettings(repoRoot, settings);
  log("[loop] Settings saved");
  return settings;
}

// Main
async function main() {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    logErr("[loop] LINEAR_API_KEY not set");
    process.exit(1);
  }

  const provider = new LinearProvider(apiKey);
  const settings = await ensureSettings(provider);

  const ralphDir = join(workDir, "scripts/ralph");
  const promptsDir = join(dirname(import.meta.path), "eternity-loop-prompts");
  const skillGuidelines = await loadSkillGuidelines();

  const ctx: WorkflowContext = {
    workDir,
    ralphDir,
    settings,
    tool: "claude",
    maxIterations,
    promptsDir,
    skillGuidelines,
  };

  const workflows: Workflow[] = [
    new ReviewWorkflow(),
    new CiFixWorkflow(),
    new NewFeatureWorkflow(),
  ].sort((a, b) => a.priority - b.priority);

  log(`[loop] Starting eternity loop (max iterations per ralph run: ${maxIterations})`);

  while (true) {
    let workFound = false;

    for (const workflow of workflows) {
      log(`[loop] Checking workflow: ${workflow.name} (priority ${workflow.priority})`);

      try {
        const issue = await workflow.check(ctx, provider);
        if (!issue) continue;

        workFound = true;
        log(`[loop] Workflow "${workflow.name}" found work: ${issue.identifier} - ${issue.title}`);

        await workflow.prepare(ctx, issue);
        const exitCode = await runRalph({ projectDir: workDir, maxIterations });
        await workflow.finalize(ctx, issue, exitCode);

        log(`[loop] Workflow "${workflow.name}" completed for ${issue.identifier}`);
        break; // Restart workflow priority loop
      } catch (err) {
        logErr(`[loop] Error in workflow "${workflow.name}": ${err}`);
      }
    }

    if (!workFound) {
      log("[loop] No work found. Sleeping 120s...");
      await Bun.sleep(120_000);
    }
  }
}

main().catch((err) => {
  logErr(`[loop] Fatal error: ${err}`);
  process.exit(1);
});
