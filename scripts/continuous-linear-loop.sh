#!/bin/bash
# Ralph Linear Loop - Autonomous task runner that pulls PRDs from Linear
# Usage: ./continuous-linear-loop.sh [--tool amp|claude] [--max-iterations N]
#
# Workflow:
# 1. Setup: detect Linear team + project (single Claude call)
# 2. Start task: fetch next issue, mark in progress, create branch, generate prd.json (single Claude call)
# 3. Run ralph-loop.sh to execute the PRD
# 4. Finalize: push branch and create GitHub PR (single Claude call)
# 5. Repeat

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_DIR="$SCRIPT_DIR/.afk-linear"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
POLL_INTERVAL=60
TOOL="claude"
MAX_ITERATIONS=50

# Extract the first valid JSON object from mixed text (handles multiline, nested braces)
extract_json_object() {
  python3 -c "
import sys, json
text = sys.stdin.read()
depth = 0
start = None
for i, ch in enumerate(text):
    if ch == '{' and depth == 0:
        start = i
        depth = 1
    elif ch == '{':
        depth += 1
    elif ch == '}' and depth > 0:
        depth -= 1
        if depth == 0 and start is not None:
            candidate = text[start:i+1]
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    print(json.dumps(parsed))
                    sys.exit(0)
            except json.JSONDecodeError:
                start = None
                continue
sys.exit(1)
"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    --max-iterations)
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --max-iterations=*)
      MAX_ITERATIONS="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# --- Helpers ---

get_setting() {
  jq -r ".$1 // empty" "$SETTINGS_FILE"
}

save_settings() {
  local team_id="$1"
  local project_id="$2"
  local work_dir="$3"
  mkdir -p "$SETTINGS_DIR"
  cat > "$SETTINGS_FILE" <<EOF
{
  "teamId": "$team_id",
  "projectId": "$project_id",
  "workingDirectory": "$work_dir"
}
EOF
  echo "Settings saved to $SETTINGS_FILE"
}

# --- Claude Call 1: Setup (detect team + project in one call) ---

setup_linear() {
  echo "Detecting Linear team and project..." >&2
  local result
  result=$(claude --dangerously-skip-permissions --print -p "Use the Linear MCP tools to:
1. List all teams (mcp__claude_ai_Linear__list_teams)
2. List all projects (mcp__claude_ai_Linear__list_projects)

Return ONLY a JSON object with these fields:
{\"teamId\": \"<team key or id>\", \"teamName\": \"<team name>\", \"projectId\": \"<project id>\", \"projectName\": \"<project name>\"}

If there is only one team, auto-select it.
If there are multiple teams, pick the first one.
If there is only one project, auto-select it.
If there are multiple projects, pick the first one.
No other text." 2>/dev/null) || true

  local json
  json=$(echo "$result" | extract_json_object) || true
  echo "$json"
}

ensure_settings() {
  mkdir -p "$SETTINGS_DIR"

  local TEAM_ID=""
  local PROJECT_ID=""
  local WORK_DIR=""

  # Load existing settings if available
  if [ -f "$SETTINGS_FILE" ]; then
    TEAM_ID=$(jq -r '.teamId // empty' "$SETTINGS_FILE" 2>/dev/null) || true
    PROJECT_ID=$(jq -r '.projectId // empty' "$SETTINGS_FILE" 2>/dev/null) || true
    WORK_DIR=$(jq -r '.workingDirectory // empty' "$SETTINGS_FILE" 2>/dev/null) || true
  fi

  # Self-repair: detect team/project if missing
  if [ -z "$TEAM_ID" ] || [ -z "$PROJECT_ID" ]; then
    echo "Settings incomplete. Running setup..."
    local setup_json
    setup_json=$(setup_linear)
    if [ -n "$setup_json" ]; then
      [ -z "$TEAM_ID" ] && TEAM_ID=$(echo "$setup_json" | jq -r '.teamId // empty') || true
      [ -z "$PROJECT_ID" ] && PROJECT_ID=$(echo "$setup_json" | jq -r '.projectId // empty') || true
      local team_name project_name
      team_name=$(echo "$setup_json" | jq -r '.teamName // "unknown"')
      project_name=$(echo "$setup_json" | jq -r '.projectName // "unknown"')
      echo "Team: $team_name ($TEAM_ID)"
      echo "Project: $project_name ($PROJECT_ID)"
    fi
  fi

  # Self-repair: fix working directory if missing or relative
  if [ -z "$WORK_DIR" ] || [[ "$WORK_DIR" != /* ]]; then
    WORK_DIR="$(pwd)"
    echo "Working directory set to: $WORK_DIR"
  fi

  save_settings "$TEAM_ID" "$PROJECT_ID" "$WORK_DIR"
}

ensure_main_branch() {
  local work_dir="$1"
  cd "$work_dir"
  echo "Ensuring main branch is up-to-date..."
  git checkout main 2>/dev/null || git checkout master
  git pull --ff-only
  echo "On $(git branch --show-current), up-to-date."
}

# --- Claude Call 2: Start task (fetch issue + mark in progress + create branch + generate prd.json) ---

start_task() {
  local team_id="$1"
  local work_dir="$2"
  local project_id="${3:-}"
  local ralph_dir="$work_dir/scripts/ralph"

  echo "Fetching and starting next task..." >&2

  local project_filter=""
  if [ -n "$project_id" ]; then
    project_filter=" in project ID '$project_id'"
  fi

  mkdir -p "$ralph_dir"

  local result
  result=$(cd "$work_dir" && claude --dangerously-skip-permissions --print -p "Do the following steps in order:

1. Use the Linear MCP (mcp__claude_ai_Linear__list_issues) to find issues for team '$team_id'${project_filter} with status 'Todo' that have the label 'prd'. Get the first issue found.

2. If no issues are found, respond with exactly: NO_ISSUES_FOUND

3. If an issue is found:
   a. Use the Linear MCP to update that issue's status to 'In Progress'
   b. Use the /ralph skill to convert the issue into prd.json format and save it to $ralph_dir/prd.json
   c. Return ONLY a JSON object with these fields:
      {\"id\": \"...\", \"identifier\": \"...\", \"title\": \"...\", \"description\": \"...\", \"branchName\": \"...\", \"url\": \"...\"}
      No other text after the JSON." 2>&1 | tee /dev/stderr) || true

  if echo "$result" | grep -q "NO_ISSUES_FOUND"; then
    return 1
  fi

  # Extract issue JSON from the output
  local json
  json=$(echo "$result" | extract_json_object) || true

  if [ -z "$json" ]; then
    return 1
  fi

  # Verify prd.json was created
  if [ ! -f "$ralph_dir/prd.json" ]; then
    echo "WARNING: prd.json was not generated at $ralph_dir/prd.json" >&2
    return 1
  fi

  echo "$json"
  return 0
}

# --- Claude Call 3: Finalize task (create PR) ---

finalize_task() {
  local work_dir="$1"
  local issue_json="$2"
  local is_draft="$3"

  local issue_id
  issue_id=$(echo "$issue_json" | jq -r '.identifier // .id')
  local issue_title
  issue_title=$(echo "$issue_json" | jq -r '.title')
  local issue_url
  issue_url=$(echo "$issue_json" | jq -r '.url // ""')

  local draft_flag=""
  local status_label="ready for review"
  if [ "$is_draft" = "true" ]; then
    draft_flag="--draft"
    status_label="draft (incomplete)"
  fi

  echo "Creating $status_label PR for $issue_id..."

  cd "$work_dir"

  # Push the branch
  local branch
  branch=$(git branch --show-current)
  git push -u origin "$branch" 2>/dev/null || git push origin "$branch"

  claude --dangerously-skip-permissions --print -p "Create a GitHub PR for the current branch using the gh CLI.

Title: $issue_id: $issue_title
$( [ "$is_draft" = "true" ] && echo "Make it a DRAFT PR with: gh pr create --draft" || echo "Make it a regular PR with: gh pr create" )

In the PR body include:
- Resolves $issue_id
- Link to Linear issue: $issue_url
- A summary of what was implemented based on the commits on this branch (use git log main..HEAD)

Use a HEREDOC for the body to ensure correct formatting." 2>&1 | tee /dev/stderr || true

  echo "PR created for $issue_id."
}

# --- Main Loop ---

# Suppress notifications in child processes
export DISABLE_PUSHOVER_NOTIFICATIONS=true
export RALPH_LOOP=true

echo "============================================="
echo "  Ralph Linear Loop"
echo "  Tool: $TOOL | Max iterations: $MAX_ITERATIONS"
echo "============================================="

ensure_settings

TEAM_ID=$(get_setting "teamId")
PROJECT_ID=$(get_setting "projectId")
WORK_DIR=$(get_setting "workingDirectory")

if [ -z "$TEAM_ID" ] || [ -z "$WORK_DIR" ]; then
  echo "ERROR: Missing teamId or workingDirectory in $SETTINGS_FILE"
  exit 1
fi

echo "Team: $TEAM_ID"
[ -n "$PROJECT_ID" ] && echo "Project: $PROJECT_ID"
echo "Working directory: $WORK_DIR"
echo ""

while true; do
  # Always start from a clean main branch
  ensure_main_branch "$WORK_DIR"

  # Start task: fetch issue, mark in progress, generate prd.json (single Claude call)
  ISSUE_JSON=$(start_task "$TEAM_ID" "$WORK_DIR" "$PROJECT_ID") || true

  if [ -z "$ISSUE_JSON" ]; then
    echo "No 'prd'-tagged Todo issues found. Polling again in ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  ISSUE_ID=$(echo "$ISSUE_JSON" | jq -r '.identifier // .id')
  BRANCH_NAME=$(echo "$ISSUE_JSON" | jq -r '.branchName // empty')
  [ -z "$BRANCH_NAME" ] && BRANCH_NAME="ralph/${ISSUE_ID}"

  echo ""
  echo "============================================="
  echo "  Starting task: $ISSUE_ID"
  echo "  Branch: $BRANCH_NAME"
  echo "============================================="

  # Create/checkout the feature branch
  cd "$WORK_DIR"
  git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"

  # Run ralph-loop.sh from the project directory
  echo ""
  echo "Starting ralph-loop.sh..."
  RALPH_EXIT=0
  CLAUDE_PROJECT_DIR="$WORK_DIR" "$SCRIPT_DIR/ralph-loop.sh" --tool "$TOOL" "$MAX_ITERATIONS" || RALPH_EXIT=$?

  # Finalize: create PR based on exit status
  if [ "$RALPH_EXIT" -eq 0 ]; then
    echo "Ralph completed successfully. Creating PR..."
    finalize_task "$WORK_DIR" "$ISSUE_JSON" "false"
  else
    echo "Ralph exited with status $RALPH_EXIT. Creating draft PR..."
    finalize_task "$WORK_DIR" "$ISSUE_JSON" "true"
  fi

  echo ""
  echo "Task $ISSUE_ID complete. Moving to next task..."
  echo ""
done
