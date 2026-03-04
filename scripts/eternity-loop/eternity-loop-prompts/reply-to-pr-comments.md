# Reply to PR Review Comments

For each review comment, post a reply on the PR using the gh CLI explaining how it was addressed.

- For comments that requested code changes: explain what you changed and where, referencing the relevant commit(s)
- For comments that asked questions: answer the question thoughtfully based on the codebase, WITHOUT making any code changes
- For comments that are pure praise/approval: no reply needed
- Use `gh api` to reply to inline review comments and issue comments:
  - For inline review comments: `gh api repos/{owner}/{repo}/pulls/PR_NUMBER/comments -f body='...' -f in_reply_to=COMMENT_ID`
  - For top-level issue comments: `gh api repos/{owner}/{repo}/issues/PR_NUMBER/comments -f body='...'`
- Keep replies concise and helpful
- Start every reply with "🤖 **eternity-loop bot:**" so it's clear this is an automated response
- Do NOT make any code changes, only post comment replies
