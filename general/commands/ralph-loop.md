---
allowed-tools: Bash(*)
description: Run Ralph - a long-running AI agent loop for autonomous task completion
---

## Context

This command runs Ralph, a long-running loop that executes Claude Code iterations until tasks are complete.

Ralph looks for a `scripts/ralph/` directory in your project with:
- `CLAUDE.md` - The prompt for Claude Code iterations
- `prd.json` - Product requirements (optional, for branch tracking)
- `progress.txt` - Progress log (auto-created)

## Usage

```bash
# Run with defaults (claude, 10 iterations)
"${CLAUDE_PLUGIN_ROOT}/scripts/ralph-loop.sh"

# Run with custom max iterations
"${CLAUDE_PLUGIN_ROOT}/scripts/ralph-loop.sh" 20

# Run with amp instead of claude
"${CLAUDE_PLUGIN_ROOT}/scripts/ralph-loop.sh" --tool amp

# Combine options
"${CLAUDE_PLUGIN_ROOT}/scripts/ralph-loop.sh" --tool claude 15
```

## Your task

Run the ralph-loop script. If the user provided arguments, pass them through.

If no `scripts/ralph/CLAUDE.md` file exists in the project, inform the user they need to create one first.
