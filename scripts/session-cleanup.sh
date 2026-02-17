#!/bin/bash
# session-cleanup - Remove a git worktree and close its tmux session
# Usage: session-cleanup [session-name]
# If no session name is provided and running inside tmux, uses current session

SESSION_NAME="${1:-}"

echo "Starting session cleanup..."

# If no session name provided, try to get current tmux session
if [[ -z "$SESSION_NAME" && -n "$TMUX" ]]; then
	echo "No session name provided, detecting from tmux..."
	SESSION_NAME="$(tmux display-message -p '#S')"
fi

if [[ -z "$SESSION_NAME" ]]; then
	echo "Usage: session-cleanup <session-name>" >&2
	echo "Or run from inside the tmux session you want to clean up." >&2
	exit 1
fi

echo "Session to clean up: $SESSION_NAME"

# Try to find GIT_ROOT from worktree path or current directory
WORKTREE_BASE="$HOME/code/worktrees"
WORKTREE_PATH=""

echo "Searching for worktree in $WORKTREE_BASE..."

# Search for the worktree in known locations
for repo_dir in "$WORKTREE_BASE"/*/; do
	if [[ -d "${repo_dir}${SESSION_NAME}" ]]; then
		WORKTREE_PATH="${repo_dir}${SESSION_NAME}"
		REPO_NAME="$(basename "$repo_dir")"
		echo "Found worktree at: $WORKTREE_PATH (repo: $REPO_NAME)"
		break
	fi
done

# Try current directory as fallback
if [[ -z "$WORKTREE_PATH" ]]; then
	echo "Worktree not found in standard location, checking current directory..."
	GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
	if [[ -n "$GIT_ROOT" ]]; then
		WORKTREE_PATH="$WORKTREE_BASE/$(basename "$GIT_ROOT")/$SESSION_NAME"
		REPO_NAME="$(basename "$GIT_ROOT")"
		echo "Using worktree path: $WORKTREE_PATH (repo: $REPO_NAME)"
	fi
fi

if [[ -z "$WORKTREE_PATH" ]]; then
	echo "Could not find worktree for session: $SESSION_NAME" >&2
	exit 1
fi

# Find the main repo (not worktree) for git operations
echo "Locating main repository..."
MAIN_REPO="$HOME/code/$REPO_NAME"
if [[ ! -d "$MAIN_REPO/.git" ]]; then
	echo "Main repo not at $MAIN_REPO, checking worktree gitdir..."
	# Try to find it via the worktree's gitdir
	if [[ -f "$WORKTREE_PATH/.git" ]]; then
		MAIN_REPO="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/.git$||')"
	fi
fi
echo "Main repository: $MAIN_REPO"

# Check if we're inside the session we're trying to kill
INSIDE_TARGET_SESSION=false
if [[ -n "$TMUX" ]]; then
	CURRENT_SESSION="$(tmux display-message -p '#S')"
	if [[ "$CURRENT_SESSION" == "$SESSION_NAME" ]]; then
		INSIDE_TARGET_SESSION=true
		echo "Running from inside target session"
	fi
fi

# Kill the tmux session if it exists (defer if inside target session)
echo "Checking for tmux session..."
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
	if [[ "$INSIDE_TARGET_SESSION" == true ]]; then
		echo "Will kill this tmux session after cleanup..."
	else
		echo "Killing tmux session: $SESSION_NAME..."
		tmux kill-session -t "$SESSION_NAME"
		echo "Tmux session killed."
	fi
else
	echo "No tmux session found: $SESSION_NAME"
fi

# Remove the git worktree if it exists
echo "Checking for worktree at: $WORKTREE_PATH..."
if [[ -d "$WORKTREE_PATH" ]]; then
	# Need to cd out of the worktree before removing it
	echo "Changing directory to $HOME..."
	cd "$HOME" || exit 1
	echo "Removing worktree: $WORKTREE_PATH..."
	git -C "$MAIN_REPO" worktree remove "$WORKTREE_PATH" --force
	if [[ $? -eq 0 ]]; then
		echo "Worktree removed successfully."
	else
		echo "Failed to remove worktree." >&2
		exit 1
	fi
else
	echo "No worktree found at: $WORKTREE_PATH"
fi

# Delete the branch if it exists
echo "Checking for branch: $SESSION_NAME..."
if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/$SESSION_NAME"; then
	read -p "Do you also want to delete the branch '$SESSION_NAME'? (y/n) " -n 1 -r
	echo
	if [[ $REPLY =~ ^[Yy]$ ]]; then
		echo "Deleting branch: $SESSION_NAME..."
		git -C "$MAIN_REPO" branch -D "$SESSION_NAME"
		echo "Branch '$SESSION_NAME' deleted."
	else
		echo "Keeping branch: $SESSION_NAME"
	fi
else
	echo "No branch found: $SESSION_NAME"
fi

echo "Cleanup complete."

# Kill our own session last if we're inside it
if [[ "$INSIDE_TARGET_SESSION" == true ]]; then
	echo "Killing current tmux session..."
	tmux kill-session -t "$SESSION_NAME"
fi
