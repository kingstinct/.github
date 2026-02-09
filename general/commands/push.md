---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git checkout:*), Bash(git push:*), Bash(gh pr:*), Bash(git log:*)
description: Push to git remote and ask to create PR if it doesn't exist
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Commits ahead of main !`git log --graph --oneline --first-parent --color=never origin/main..HEAD`
- View PR: !`gh pr view`

## Your task

Push the current branch to remote origin.

If there's nothing to push inform me about it.

If there's still files in the working copy, list them and ask if I want to proceed, cancel or run the /commit logic.

Once pushed ask if I want to create a PR with a suggested title and body - based on the recent git commits.  Use `gh pr create --title=pr-title --body=pr-body` for this.
