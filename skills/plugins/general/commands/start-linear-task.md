---
allowed-tools: Bash(git status:*), Bash(git pull:*), Bash(git checkout:*), mcp__linear__list_issues
description: Pick a new Linear task to start working on
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`

## Your task

First, if I'm not on the main or master branch, ask if I want to switch to it. Warn me and ask if I want to continue if I already have changes in my working copy.

Then use Linear MCP to list all tasks that are assigned to me or unassigned where the status is "Todo". Ask me which task I'd like to start with.

After I select the task proceed to first pull the latest from main/master, and then proceed to check out a branch with that gitBranchName.

Once the branch check out is done go make a plan of implementation. Ask me if anything is unclear, and finally ask me to approve the plan so you can start executing.
