# Create PRD from PR Review Feedback

Create a prd.json at the specified path to address PR review feedback.

Use the provided branch name for the `branchName` field and project name for the `project` field.

Focus on the PR review comments, not the original Linear issue (provided for context only).

## Review-specific rules
- Each piece of review feedback that needs code changes becomes a user story
- Comments that are just questions or requests for explanation should NOT become user stories - they will be answered separately
- If ALL comments are questions/explanations with no code changes needed, create a prd.json with an empty userStories array
- Include the original comment text in each user story description for context
