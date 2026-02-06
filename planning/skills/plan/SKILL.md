---
description: Create concise MVP-style implementation plans with clear test strategies
---

# Planning Guidelines

Create minimal, focused implementation plans. No extra features, no scope creep.

## Before Planning

**Always gather context first:**

1. Check if there's an existing issue/task:
   - GitHub Issue (check conversation or fetch via `gh issue view`)
   - Linear task (use Linear MCP tools)
   - Sentry issue (use Sentry MCP tools)
   - Branch name may imply a ticket (e.g., `fix/LIN-123-auth-bug`)

2. If no issue is provided, ask the user:
   > "Is there a GitHub issue, Linear task, or Sentry issue for this? If so, please share the link or ID."

3. Fetch the issue to understand:
   - Acceptance criteria
   - Context and background
   - Related discussions

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

## Planning Principles

- **MVP only**: Implement exactly what's asked, nothing more
- **No gold-plating**: Skip nice-to-haves, optimizations, and "while we're at it" additions
- **Clarify ambiguity**: Ask questions before planning, not during implementation
- **Concise format**: Use bullet points, not paragraphs

## Plan Structure

```markdown
## Goal
[One sentence describing what we're building/fixing]

## Changes
- [ ] File: brief change description
- [ ] File: brief change description

## Questions
- [Any unclear requirements - ASK BEFORE PROCEEDING]

## Test Plan
[See testing section below]
```

## Ask Questions For

- Unclear requirements or edge cases
- Multiple valid implementation approaches
- Missing acceptance criteria
- Ambiguous UI/UX decisions
- Performance requirements
- Error handling expectations

## Test Plan Requirements

Always include a test plan. Focus on:

### Backend Changes → Integration Tests

```markdown
## Test Plan
- [ ] Integration: POST /api/users creates user and returns 201
- [ ] Integration: POST /api/users with invalid email returns 400
- [ ] Integration: GET /api/users/:id returns user data
```

### Expo Mobile Apps → E2E with Expo MCP

Use the iOS Simulator MCP tools for E2E testing:

```markdown
## Test Plan
- [ ] E2E: Tap login button → navigates to login screen
- [ ] E2E: Enter credentials → shows home screen
- [ ] E2E: Invalid credentials → shows error message
```

### Web Apps → E2E with Browser Tools

Use browser automation tools for E2E testing:

```markdown
## Test Plan
- [ ] E2E: Navigate to /login → form is visible
- [ ] E2E: Submit valid credentials → redirects to dashboard
- [ ] E2E: Submit invalid credentials → shows error toast
```

### Unit Tests (Only When Valuable)

Only for complex pure functions or utilities:

```markdown
- [ ] Unit: calculateDiscount handles edge cases
```

## Anti-Patterns

- Adding "future-proofing" abstractions
- Refactoring unrelated code
- Adding optional features
- Over-engineering error handling
- Creating unnecessary configuration options
- Adding analytics/logging unless requested
