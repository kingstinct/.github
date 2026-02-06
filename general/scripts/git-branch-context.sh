#!/usr/bin/env bash
set -euo pipefail

# Fallback if origin/main doesn't exist (some repos use master, or different name)
MAIN="origin/main"
if ! git rev-parse --verify "$MAIN" >/dev/null 2>&1; then
    MAIN="origin/master"  # try the classic fallback
    if ! git rev-parse --verify "$MAIN" >/dev/null 2>&1; then
        MAIN=""  # will show fallback message below
    fi
fi

# Try to get the graph (color off → cleaner in markdown context)
if [[ -n "$MAIN" ]]; then
    LOG=$(git log --graph --oneline --first-parent --color=never "$MAIN"..HEAD 2>/dev/null || echo "")
else
    LOG=""
fi

if [[ -z "$LOG" ]]; then
    LOG="(no commits on current branch ahead of $MAIN – or not a git repo / origin/main not found)"
fi

cat << EOF

<git-branch-graph>
Current branch commits ahead of main:

$LOG

</git-branch-graph>

EOF

exit 0
