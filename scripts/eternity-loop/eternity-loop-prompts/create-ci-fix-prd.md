# Create PRD from CI Failure Logs

Create a prd.json at the specified path to fix CI failures on an existing PR.

Use the provided branch name for the `branchName` field and project name for the `project` field.

Focus on the CI failure logs, not the original Linear issue (provided for context only).

## CI-fix-specific rules
- Investigate each CI failure until you've found a potential root cause
- Each distinct CI failure becomes a user story
- Group failures that share the same root cause into a single user story
- Keep fixes minimal — do NOT refactor unrelated code or make improvements beyond what's needed to fix the failures
- Every user story MUST include an acceptance criterion that the step that failed in CI passes locally (look into the workflow to determine what has to run locally)
- Commit messages should use `fix(ci):` prefix
- If the failure logs are unclear, include a user story for investigating and diagnosing the failure
