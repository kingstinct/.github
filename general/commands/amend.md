---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git checkout:*)
description: Amend the latest git commit
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes, amend the latest commit by adding any files in the working copy as well as updating the commit message to reflect the entirety of it. If there's a mix of staged and unstaged files, ask me if I want to add the unstaged changes to the commit. If the last commit is already pushed to origin ask if I really want to amend or do a new commit. If there's no files in the working copy ask if I want to just update the commit message based on your recommendation.
