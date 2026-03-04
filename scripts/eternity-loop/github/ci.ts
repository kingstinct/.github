import type { Octokit } from "@octokit/rest";
import { join } from "node:path";

interface CiFixTracking {
  fixedShas: string[];
}

async function loadTracking(settingsDir: string): Promise<CiFixTracking> {
  const trackingPath = join(settingsDir, "ci-fix-tracking.json");
  const file = Bun.file(trackingPath);
  if (await file.exists()) {
    return file.json();
  }
  return { fixedShas: [] };
}

export async function checkPrHasCiFailures(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  settingsDir: string,
): Promise<boolean> {
  // Layer 1: Skip if latest commit starts with 'fix(ci):'
  const commitResult = await Bun.$`git log -1 --format=%s origin/${branch}`.quiet().text();
  if (commitResult.trim().startsWith("fix(ci):")) {
    return false;
  }

  // Layer 2: Skip if HEAD SHA already tracked
  const sha = await Bun.$`git rev-parse origin/${branch}`.quiet().text();
  const headSha = sha.trim();
  const tracking = await loadTracking(settingsDir);
  if (tracking.fixedShas.includes(headSha)) {
    return false;
  }

  // Layer 3: Skip if any checks are pending
  const { data: combinedStatus } = await octokit.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: branch,
  });

  const { data: checkRuns } = await octokit.checks.listForRef({
    owner,
    repo,
    ref: branch,
    per_page: 100,
  });

  const hasPending =
    combinedStatus.statuses.some((s) => s.state === "pending") ||
    checkRuns.check_runs.some((c) => c.status !== "completed");

  if (hasPending) {
    return false;
  }

  // Check for actual failures
  const hasFailedStatus = combinedStatus.statuses.some((s) => s.state === "failure" || s.state === "error");
  const hasFailedCheck = checkRuns.check_runs.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );

  return hasFailedStatus || hasFailedCheck;
}

export async function getCiFailureDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  branch: string,
): Promise<string> {
  const { data: checkRuns } = await octokit.checks.listForRef({
    owner,
    repo,
    ref: branch,
    per_page: 100,
  });

  const failedChecks = checkRuns.check_runs.filter(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );

  if (failedChecks.length === 0) {
    return "No CI failures found.";
  }

  const parts: string[] = [`## CI Failures for PR #${prNumber}\n`];

  for (const check of failedChecks) {
    parts.push(`### ${check.name} (${check.conclusion})`);

    // Try to get logs via actions API
    if (check.details_url?.includes("/actions/runs/")) {
      const runIdMatch = check.details_url.match(/\/runs\/(\d+)/);
      if (runIdMatch) {
        try {
          const runId = parseInt(runIdMatch[1], 10);
          const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
            owner,
            repo,
            run_id: runId,
          });

          const failedJob = jobs.jobs.find(
            (j) => j.conclusion === "failure" && j.name === check.name,
          );

          if (failedJob) {
            const { data: logData } = await octokit.actions.downloadJobLogsForWorkflowRun({
              owner,
              repo,
              job_id: failedJob.id,
            });

            const log = typeof logData === "string" ? logData : String(logData);
            const lines = log.split("\n");

            if (lines.length > 500) {
              const first100 = lines.slice(0, 100).join("\n");
              const last400 = lines.slice(-400).join("\n");
              parts.push("```");
              parts.push(first100);
              parts.push("\n... (truncated) ...\n");
              parts.push(last400);
              parts.push("```");
            } else {
              parts.push("```");
              parts.push(log);
              parts.push("```");
            }
          }
        } catch {
          parts.push("(Could not retrieve logs)");
        }
      }
    }

    parts.push("");
  }

  return parts.join("\n");
}
