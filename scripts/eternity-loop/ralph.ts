import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { log } from "./logger";

export async function runRalph(options: {
  projectDir: string;
  maxIterations: number;
}): Promise<number> {
  const { projectDir, maxIterations } = options;
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

  log("[ralph] Starting Ralph - Max iterations:", maxIterations);

  for (let i = 1; i <= maxIterations; i++) {
    log(`[ralph] ===============================================================`);
    log(`[ralph]   Iteration ${i} of ${maxIterations}`);
    log(`[ralph] ===============================================================`);

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
      log(`[ralph] Iteration ${i} exited with error, continuing...`);
    }

    // Check for completion signal
    if (output.includes("<promise>COMPLETE</promise>")) {
      log(`[ralph] Ralph completed all tasks at iteration ${i} of ${maxIterations}!`);
      await sendNotification(
        `Ralph completed all tasks! ✅ (iteration ${i}/${maxIterations} in ${projectDir})`,
      );
      return 0;
    }

    log(`[ralph] Iteration ${i} complete. Continuing...`);
  }

  log(`[ralph] Ralph reached max iterations (${maxIterations}) without completing all tasks.`);
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
