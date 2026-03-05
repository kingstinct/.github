import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { log, logWorkflow, startSpinner } from "./logger";

interface UserStory {
  id: string;
  title: string;
  passes: boolean;
}

interface Prd {
  userStories: UserStory[];
}

async function readPrd(prdFile: string): Promise<Prd | null> {
  try {
    const file = Bun.file(prdFile);
    if (!(await file.exists())) return null;
    return await file.json() as Prd;
  } catch {
    return null;
  }
}

export async function runRalph(options: {
  projectDir: string;
  maxIterations: number;
  workflowName?: string;
}): Promise<number> {
  const { projectDir, maxIterations, workflowName } = options;
  const ralphDir = join(projectDir, "scripts/ralph");
  const prdFile = join(ralphDir, "prd.json");
  const progressFile = join(ralphDir, "progress.txt");
  const archiveDir = join(ralphDir, "archive");
  const claudeMdFile = join(ralphDir, "CLAUDE.md");

  await mkdir(ralphDir, { recursive: true });

  // Archive previous run if progress.txt exists
  const progressExists = await Bun.file(progressFile).exists();
  if (progressExists) {
    const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archiveFolder = join(archiveDir, date);
    await mkdir(archiveFolder, { recursive: true });

    const prdExists = await Bun.file(prdFile).exists();
    if (prdExists) {
      await Bun.$`cp ${prdFile} ${archiveFolder}/`.quiet();
    }
    await Bun.$`cp ${progressFile} ${archiveFolder}/`.quiet();
  }

  // Start fresh progress.txt
  await Bun.write(progressFile, `# Ralph Progress Log\nStarted: ${new Date().toString()}\n---\n`);

  const logColored = workflowName
    ? (...args: unknown[]) => logWorkflow(workflowName, ...args)
    : (...args: unknown[]) => log(...args);

  logColored("[ralph] Starting Ralph - Max iterations:", maxIterations);

  for (let i = 1; i <= maxIterations; i++) {
    logColored(`[ralph] ===============================================================`);
    logColored(`[ralph]   Iteration ${i} of ${maxIterations}`);
    logColored(`[ralph] ===============================================================`);

    // Log current step before iteration
    const prdBefore = await readPrd(prdFile);
    if (prdBefore) {
      const nextStory = prdBefore.userStories.find((s) => !s.passes);
      if (nextStory) {
        logColored(`[ralph] Starting: ${nextStory.id} - ${nextStory.title}`);
      }
    }

    logColored(`[ralph] Running Claude, this could take a while...`);
    const spinner = startSpinner(`Ralph iteration ${i}/${maxIterations} running...`);
    let output: string;
    try {
      output = await Bun.$`claude --dangerously-skip-permissions --print < ${claudeMdFile}`
        .cwd(projectDir)
        .env({
          ...process.env,
          DISABLE_PUSHOVER_NOTIFICATIONS: "true",
          RALPH_LOOP: "true",
        })
        .text();
    } catch (e: unknown) {
      const err = e as { stdout?: { toString(): string } };
      output = err.stdout?.toString() ?? "";
      logColored(`[ralph] Iteration ${i} exited with error, continuing...`);
    } finally {
      spinner.stop();
    }

    // Log progress after iteration
    const prdAfter = await readPrd(prdFile);
    if (prdAfter) {
      const passed = prdAfter.userStories.filter((s) => s.passes).length;
      const total = prdAfter.userStories.length;
      logColored(`[ralph] Progress: ${passed}/${total} user stories complete`);
    }

    // Check for completion signal
    if (output.includes("<promise>COMPLETE</promise>")) {
      logColored(`[ralph] Ralph completed all tasks at iteration ${i} of ${maxIterations}!`);
      await sendNotification(
        `Ralph completed all tasks! ✅ (iteration ${i}/${maxIterations} in ${projectDir})`,
      );
      return 0;
    }

    logColored(`[ralph] Iteration ${i} complete. Continuing...`);
  }

  logColored(`[ralph] Ralph reached max iterations (${maxIterations}) without completing all tasks.`);
  await sendNotification(
    `Ralph reached max iterations (${maxIterations}) in ${projectDir} ⚠️`,
  );
  return 1;
}

async function sendNotification(message: string): Promise<void> {
  const scriptPath = join(
    process.env.HOME ?? "",
    ".claude/plugins/cache/kingstinct-skills/general/1.1.0/scripts/pushover-notification.sh",
  );
  const exists = await Bun.file(scriptPath).exists();
  if (!exists) return;

  try {
    await Bun.$`MESSAGE=${message} ${scriptPath}`.env({
      ...process.env,
      DISABLE_PUSHOVER_NOTIFICATIONS: undefined as unknown as string,
      RALPH_LOOP: undefined as unknown as string,
      MESSAGE: message,
    }).quiet();
  } catch {
    // Notification failure is non-critical
  }
}
