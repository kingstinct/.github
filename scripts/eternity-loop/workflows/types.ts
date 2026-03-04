import type { IssueProvider } from "../providers/types";
import type { Issue, WorkflowContext } from "../types";

export interface Workflow {
  name: string;
  priority: number;
  check(ctx: WorkflowContext, provider: IssueProvider): Promise<Issue | null>;
  prepare(ctx: WorkflowContext, issue: Issue): Promise<void>;
  finalize(ctx: WorkflowContext, issue: Issue, ralphExitCode: number): Promise<void>;
}
