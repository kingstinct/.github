---
description: Guidelines for using Linear, Sentry, and GitHub integrations
---

# Integration Tools

This plugin provides MCP integrations for Linear, Sentry, and GitHub. Use them appropriately based on context.

## Linear MCP

Use for project management and task tracking.

**When to use:**
- Fetching task details, descriptions, and acceptance criteria
- Updating task status (Todo → In Progress → Done)
- Creating new issues or sub-tasks
- Listing assigned tasks or backlog items
- Getting project/cycle information

**Common operations:**
- `mcp__linear__get_issue` - Get full issue details including description
- `mcp__linear__list_issues` - List issues with filters (assignee, status, project)
- `mcp__linear__update_issue` - Update status, assignee, or other fields
- `mcp__linear__create_issue` - Create new issues
- `mcp__linear__list_comments` - View discussion on an issue

## Sentry MCP

Use for error tracking and debugging.

**When to use:**
- Investigating bug reports or error tickets
- Understanding error frequency and impact
- Getting stack traces and error context
- Checking if an error is new or recurring
- Finding related errors

**Common operations:**
- `mcp__sentry__get_issue` - Get error details, stack trace, frequency
- `mcp__sentry__list_issues` - List recent errors by project
- Look for Sentry issue links in Linear tasks or GitHub issues

## GitHub MCP

Use for repository and PR management.

**When to use:**
- Fetching PR details or review comments
- Getting issue descriptions and discussions
- Checking CI/workflow status
- Understanding repository structure

**Also available via `gh` CLI:**
- `gh issue view <number>` - View issue details
- `gh pr view <number>` - View PR details
- `gh pr checks` - Check CI status
- `gh api` - Direct API access

## Project Scope

**Always filter by relevant projects** when querying Linear, Sentry, or GitHub.

### Before Querying

1. Check `CLAUDE.md` in the project root for configured project scope
2. If project scope is missing or unclear for ANY service you need to query:
   - **Linear**: Ask which Linear team/project to filter by
   - **Sentry**: Ask which Sentry project slug to use
   - **GitHub**: Ask which org/repo if not obvious from git remote
3. Save the answer to `CLAUDE.md` for future sessions

### CLAUDE.md Format

```markdown
## Project Scope

- Linear projects: ProjectName1, ProjectName2
- Linear team: TeamName
- Sentry projects: project-slug-1, project-slug-2
- GitHub repos: org/repo-name
```

### Filtering Queries

Always pass project filters - never query without them:

- **Linear**: Use `project` or `team` parameter in `mcp__linear__list_issues`
- **Sentry**: Always specify project slug
- **GitHub**: Use correct org/repo, check git remote if unsure (`git remote -v`)

### When to Ask

Ask for clarification when:
- No project scope in `CLAUDE.md`
- Multiple projects could apply
- Creating a new issue (which project?)
- Listing issues without clear context
- The current git repo doesn't match configured GitHub repos

## Best Practices

1. **Filter by project scope**: Always use project filters to avoid irrelevant results
2. **Check for linked issues first**: Tasks often link to Sentry errors or GitHub issues
3. **Fetch context before planning**: Get full issue details before starting work
4. **Update status as you work**: Move Linear tasks to "In Progress" when starting
5. **Link PRs to issues**: Reference Linear/GitHub issues in PR descriptions
