#!/bin/bash
# session-init - Create or attach to a tmux session with git worktree
# Usage: session-init [session-name]
# If no session name provided, uses the root repo directly

SESSION_NAME="${1:-}"

GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$GIT_ROOT" ]]; then
	echo "Not inside a git repository." >&2
	exit 1
fi

REPO_NAME="$(basename "$GIT_ROOT")"

# If no session name provided, use the root repo directly
if [[ -z "$SESSION_NAME" ]]; then
	CURRENT_BRANCH="$(git -C "$GIT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
	TMUX_SESSION_NAME="$REPO_NAME-$CURRENT_BRANCH"
	echo "No session name provided, using root repo: $GIT_ROOT (branch: $CURRENT_BRANCH)"
	cd "$GIT_ROOT" || exit 1
	tmux new-session -A -s "$TMUX_SESSION_NAME"
	exit 0
fi

# Determine the default branch (main or master)
if git -C "$GIT_ROOT" show-ref --verify --quiet refs/heads/main; then
	DEFAULT_BRANCH="main"
elif git -C "$GIT_ROOT" show-ref --verify --quiet refs/heads/master; then
	DEFAULT_BRANCH="master"
else
	echo "Could not find main or master branch." >&2
	exit 1
fi

# Check current branch
CURRENT_BRANCH="$(git -C "$GIT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
BASE_BRANCH="$DEFAULT_BRANCH"

# Ask if user wants to continue from current branch (if not on main/master)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
	echo "You are currently on branch: $CURRENT_BRANCH"
	read -p "Do you want to continue from this branch (or switch to $DEFAULT_BRANCH)? (y/n) " -n 1 -r
	echo
	if [[ $REPLY =~ ^[Yy]$ ]]; then
		BASE_BRANCH="$CURRENT_BRANCH"
	fi
fi

WORKTREE_BASE="$HOME/code/worktrees/$REPO_NAME"
WORKTREE_PATH="$WORKTREE_BASE/$SESSION_NAME"

mkdir -p "$WORKTREE_BASE"

# Check if worktree already exists
if [[ -d "$WORKTREE_PATH" ]]; then
	echo "Worktree already exists at: $WORKTREE_PATH"
	cd "$WORKTREE_PATH" || exit 1
	tmux new-session -A -s "$SESSION_NAME"
	exit 0
fi

# Check if branch already exists
if git -C "$GIT_ROOT" show-ref --verify --quiet "refs/heads/$SESSION_NAME"; then
	echo "Branch '$SESSION_NAME' already exists, creating worktree from it..."
	git -C "$GIT_ROOT" worktree add "$WORKTREE_PATH" "$SESSION_NAME"
	cd "$WORKTREE_PATH" || exit 1
	tmux new-session -A -s "$SESSION_NAME"
	exit 0
fi

# Pull latest changes for the base branch before creating new worktree
echo "Pulling latest changes for $BASE_BRANCH..."
git -C "$GIT_ROOT" fetch origin "$BASE_BRANCH" && git -C "$GIT_ROOT" checkout "$BASE_BRANCH" && git -C "$GIT_ROOT" pull origin "$BASE_BRANCH"
if [[ $? -ne 0 ]]; then
	echo "Failed to pull latest changes." >&2
	exit 1
fi

echo "Creating new worktree with branch '$SESSION_NAME' from '$BASE_BRANCH'..."
git -C "$GIT_ROOT" worktree add "$WORKTREE_PATH" -b "$SESSION_NAME" "$BASE_BRANCH"

cd "$WORKTREE_PATH" || exit 1
tmux new-session -A -s "$SESSION_NAME"