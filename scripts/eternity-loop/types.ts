export interface CliArgs {
  tool: string;
  maxIterations: number;
}

export interface Settings {
  teamId: string;
  projectId: string;
  workingDirectory: string;
}

export interface Issue {
  uuid: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  branchName: string;
  stateName: string;
  prNumber?: number;
}

export type TaskType = "review" | "ci-fix" | "new";

export interface WorkflowContext {
  workDir: string;
  ralphDir: string;
  settings: Settings;
  tool: string;
  maxIterations: number;
  promptsDir: string;
  skillGuidelines: string;
}
