import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Settings } from "./types";

function settingsPath(repoRoot: string): string {
  return join(repoRoot, ".eternity-loop", "settings.json");
}

export async function loadSettings(repoRoot: string): Promise<Settings | null> {
  const file = Bun.file(settingsPath(repoRoot));
  if (!(await file.exists())) {
    return null;
  }
  return file.json() as Promise<Settings>;
}

export async function saveSettings(repoRoot: string, settings: Settings): Promise<void> {
  const path = settingsPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(settings, null, 2) + "\n");
}
