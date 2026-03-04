import { join, dirname } from "node:path";

const promptsDir = join(dirname(import.meta.path), "eternity-loop-prompts");
const skillPath = join(dirname(import.meta.path), "..", "..", "general", "skills", "ralph", "SKILL.md");

export async function readPrompt(filename: string): Promise<string> {
  const file = Bun.file(join(promptsDir, filename));
  if (await file.exists()) {
    return file.text();
  }
  return `# ${filename} (prompt file not found)`;
}

export async function loadSkillGuidelines(): Promise<string> {
  const file = Bun.file(skillPath);
  if (await file.exists()) {
    return file.text();
  }
  return "# SKILL.md (skill guidelines not found)";
}
