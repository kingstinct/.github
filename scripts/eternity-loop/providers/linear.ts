import { LinearClient } from "@linear/sdk";
import type { Issue } from "../types";
import type { IssueFilter, IssueProvider } from "./types";

export class LinearProvider implements IssueProvider {
  private client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async fetchTeamsAndProjects(): Promise<
    Array<{ teamId: string; teamName: string; projects: Array<{ id: string; name: string }> }>
  > {
    const teamsConnection = await this.client.teams({ first: 50 });
    const results: Array<{
      teamId: string;
      teamName: string;
      projects: Array<{ id: string; name: string }>;
    }> = [];

    for (const team of teamsConnection.nodes) {
      const projectsConnection = await team.projects({ first: 50 });
      results.push({
        teamId: team.id,
        teamName: team.name,
        projects: projectsConnection.nodes.map((p) => ({ id: p.id, name: p.name })),
      });
    }

    return results;
  }

  async queryIssues(filter: IssueFilter, limit = 50): Promise<Issue[]> {
    const issueFilter: Record<string, unknown> = {
      team: { id: { eq: filter.teamId } },
    };

    if (filter.projectId) {
      issueFilter.project = { id: { eq: filter.projectId } };
    }

    if (filter.stateName) {
      issueFilter.state = { name: { eq: filter.stateName } };
    }

    if (filter.labels && filter.labels.length > 0) {
      issueFilter.labels = {
        some: { name: { in: filter.labels } },
      };
    }

    const connection = await this.client.issues({
      filter: issueFilter,
      first: limit,
    });

    const issues: Issue[] = [];
    for (const node of connection.nodes) {
      const state = await node.state;
      issues.push({
        uuid: node.id,
        identifier: node.identifier,
        title: node.title,
        description: node.description ?? "",
        url: node.url,
        branchName: node.branchName,
        stateName: state?.name ?? "",
      });
    }

    return issues;
  }

  async transitionIssue(uuid: string, stateName: string): Promise<void> {
    const issue = await this.client.issue(uuid);
    const team = await issue.team;
    if (!team) {
      throw new Error(`No team found for issue "${uuid}"`);
    }
    const statesConnection = await team.states({ first: 50 });

    const targetState = statesConnection.nodes.find((s) => s.name === stateName);
    if (!targetState) {
      throw new Error(`Workflow state "${stateName}" not found for team "${team.name}"`);
    }

    await issue.update({ stateId: targetState.id });
  }
}
