#!/usr/bin/env bash
set -euo pipefail

# Check if any commits were made this session and suggest docs-updater

# Get session start commit if available
SESSION_FILE_PATH=$(cat /tmp/claude-session-file-path 2>/dev/null || echo "")
if [[ -n "$SESSION_FILE_PATH" && -f "$SESSION_FILE_PATH" ]]; then
    SESSION_START=$(cat "$SESSION_FILE_PATH")
else
    # Fallback: assume last 5 commits as session scope
    SESSION_START=$(git rev-parse HEAD~5 2>/dev/null || echo "")
fi

# Check if there are new commits since session start
if [[ -n "$SESSION_START" ]]; then
    COMMIT_COUNT=$(git rev-list --count "$SESSION_START"..HEAD 2>/dev/null || echo "0")

    if [[ "$COMMIT_COUNT" -gt 0 ]]; then
        echo "SPAWN_AGENT: docs-updater"
        echo "AGENT_PROMPT: Update documentation based on the $COMMIT_COUNT commit(s) made this session. Session started at $SESSION_START. Run: git log --oneline $SESSION_START..HEAD"
    fi
fi

# Cleanup session file
rm -f "$SESSION_FILE_PATH" 2>/dev/null || true
rm -f /tmp/claude-session-file-path 2>/dev/null || true

exit 0
