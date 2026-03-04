import type { Issue } from "../types";

export interface IssueFilter {
  teamId: string;
  projectId?: string;
  stateName?: string;
  labels?: string[];
}

export interface IssueProvider {
  fetchTeamsAndProjects(): Promise<
    Array<{ teamId: string; teamName: string; projects: Array<{ id: string; name: string }> }>
  >;
  queryIssues(filter: IssueFilter, limit?: number): Promise<Issue[]>;
  transitionIssue(uuid: string, stateName: string): Promise<void>;
}
