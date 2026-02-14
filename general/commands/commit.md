---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git checkout:*), Task
description: Create a git commit
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the current changeset create a git commit.

If there's a mix of staged and unstaged files, ask me if I want to add the unstaged changes to the commit. If all files are of the same status just add them all to the commit and proceed.

If I'm on the main/master branch ask if I want to check out a branch with a suggested name before proceeding with the commit.

If the commit contains clearly unrelated things, ask if I want to split it into multiple commits.

## After Commit

After the commit succeeds, spawn the `docs-updater` agent in the background to update documentation:

```
Task(subagent_type="docs-updater", run_in_background=true, prompt="Update documentation based on the latest commit. Check git diff HEAD~1 for changes.")
```
