#!/bin/bash
# Eternity Loop - Autonomous task runner that pulls PRDs from Linear
# Usage: eternity-loop.sh [--tool amp|claude] [--max-iterations N]
#
# Runs in its own git worktree and tmux session called "eternity-loop".
# If already running, attaches to the existing session.
#
# Workflow:
# 1. Setup: detect Linear team + project (via Linear GraphQL API)
# 2. Check for "In Review"/"In Progress" issues with new PR comments (via Linear API, prioritized)
# 3. If no reviews: fetch next "Todo" issue via Linear API, mark in progress, create branch, generate prd.json (Claude call)
# 4. Run ralph-loop.sh to execute the PRD
# 5. Finalize: push branch and create GitHub PR (single Claude call)
# 6. Repeat

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
TMUX_SESSION="eternity-loop-${PROJECT_NAME}"
WORKTREE_NAME="eternity-loop"

# Load .env from standard candidate paths (first match wins)
# Priority: .env.local > .env, checked in: cwd > script dir > repo root (when in worktree)
load_env() {
  for _env_candidate in \
    "$(pwd)/.env.local" \
    "$(pwd)/.env" \
    "$SCRIPT_DIR/.env.local" \
    "$SCRIPT_DIR/.env" \
    "${ETERNITY_LOOP_REPO_ROOT:-}/.env.local" \
    "${ETERNITY_LOOP_REPO_ROOT:-}/.env" \
    "${ETERNITY_LOOP_REPO_ROOT:-}/scripts/.env.local" \
    "${ETERNITY_LOOP_REPO_ROOT:-}/scripts/.env"; do
    [ -z "$_env_candidate" ] && continue
    if [ -f "$_env_candidate" ]; then
      set -a; source "$_env_candidate"; set +a
      break
    fi
  done
}

# --- Worktree + tmux bootstrap ---
# If not already inside the eternity-loop tmux session, set up worktree and launch
if [ -z "${ETERNITY_LOOP_INSIDE:-}" ]; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/$WORKTREE_NAME"

  # Load .env in bootstrap phase so LINEAR_API_KEY can be passed to tmux
  load_env

  # Determine the main branch name
  MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@') || true
  [ -z "$MAIN_BRANCH" ] && MAIN_BRANCH="main"

  # Kill existing tmux session if running
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "Killing existing tmux session '$TMUX_SESSION'..."
    tmux kill-session -t "$TMUX_SESSION"
  fi

  # Remove existing worktree and create fresh
  if [ -d "$WORKTREE_PATH" ]; then
    echo "Removing existing worktree at $WORKTREE_PATH..."
    git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || rm -rf "$WORKTREE_PATH"
  fi
  mkdir -p "$(dirname "$WORKTREE_PATH")"
  git fetch origin 2>/dev/null || true
  echo "Creating git worktree at $WORKTREE_PATH (branch: $MAIN_BRANCH)..."
  git worktree add "$WORKTREE_PATH" --detach "origin/$MAIN_BRANCH"

  # Launch a new tmux session running this script inside the worktree
  # After the script exits, clean up the worktree
  echo "Starting tmux session '$TMUX_SESSION' in worktree $WORKTREE_PATH..."
  exec tmux new-session -s "$TMUX_SESSION" \
    "cd '$WORKTREE_PATH' && ETERNITY_LOOP_INSIDE=1 ETERNITY_LOOP_WORKTREE='$WORKTREE_PATH' ETERNITY_LOOP_REPO_ROOT='$REPO_ROOT' LINEAR_API_KEY='${LINEAR_API_KEY:-}' '$SCRIPT_DIR/eternity-loop.sh' $*; echo 'Eternity loop exited. Press enter to close.'; read"
fi

# --- From here on we're inside the tmux session, in the worktree ---

# Clean up the worktree on exit
cleanup_worktree() {
  if [ -n "${ETERNITY_LOOP_WORKTREE:-}" ] && [ -n "${ETERNITY_LOOP_REPO_ROOT:-}" ]; then
    echo ""
    echo "Cleaning up worktree at $ETERNITY_LOOP_WORKTREE..."
    cd "$ETERNITY_LOOP_REPO_ROOT"
    git worktree remove --force "$ETERNITY_LOOP_WORKTREE" 2>/dev/null || rm -rf "$ETERNITY_LOOP_WORKTREE"
    echo "Worktree removed."
  fi
}

# Ensure Ctrl-C kills the entire process tree and cleans up worktree
trap 'echo ""; echo "Interrupted. Cleaning up..."; cleanup_worktree; kill 0; exit 130' INT TERM
trap 'cleanup_worktree' EXIT

POLL_INTERVAL=120
TOOL="claude"
MAX_ITERATIONS=50

# Timestamped logging
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}
log_err() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# Load .env if present (for LINEAR_API_KEY)
load_env

if [ -z "${LINEAR_API_KEY:-}" ]; then
  log "ERROR: LINEAR_API_KEY is not set. Set it in your shell environment or in a .env file (project root or scripts directory)."
  exit 1
fi

linear_graphql() {
  local query="$1"
  local variables="${2:-"{}"}"
  [ -z "$variables" ] && variables="{}"
  local payload
  payload="$(jq -n --arg q "$query" --argjson v "$variables" '{query: $q, variables: $v}')"
  log_err "[linear-api] Request: $(echo "$payload" | jq -c '.variables' 2>/dev/null || echo "$payload")"
  local response
  response=$(curl -s -X POST https://api.linear.app/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$payload")
  log_err "[linear-api] Response: $(echo "$response" | head -c 1000)"
  echo "$response"
}

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

# Settings directory lives in the root repo (not worktree) so it persists across sessions
SETTINGS_DIR="${ETERNITY_LOOP_REPO_ROOT:-$(pwd)}/.eternity-loop"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

# --- Helpers ---

get_setting() {
  jq -r ".$1 // empty" "$SETTINGS_FILE"
}

# Extract common fields from issue JSON, sets: issue_id, issue_title, issue_url, branch_name
# Writes JSON to a temp file to avoid pipe/shell-expansion issues with special chars in descriptions
parse_issue_fields() {
  local _pif_tmp
  _pif_tmp=$(mktemp)
  echo "$1" > "$_pif_tmp"
  issue_id=$(jq -r '.identifier // .id' "$_pif_tmp") || true
  issue_title=$(jq -r '.title' "$_pif_tmp") || true
  issue_url=$(jq -r '.url // ""' "$_pif_tmp") || true
  branch_name=$(jq -r '.branchName // empty' "$_pif_tmp") || true
  rm -f "$_pif_tmp"
  [ -z "$branch_name" ] && branch_name="ralph/${issue_id}"
  log_err "[parse_issue_fields] id=$issue_id branch=$branch_name"
}

# Build a Linear issue filter for a team, optionally scoped to a project
build_issue_filter() {
  local team_id="$1"
  local project_id="${2:-}"
  local extra_filter="${3:-}"
  local filter
  filter=$(jq -n --arg tid "$team_id" '{
    team: {id: {eq: $tid}}
  }')
  if [ -n "$extra_filter" ]; then
    filter=$(echo "$filter" | jq --argjson extra "$extra_filter" '. + $extra')
  fi
  if [ -n "$project_id" ]; then
    filter=$(echo "$filter" | jq --arg pid "$project_id" '. + {project: {id: {eq: $pid}}}')
  fi
  echo "$filter"
}

# Verify prd.json was created and log its contents
verify_prd() {
  local prd_path="$1"
  local label="$2"
  if [ ! -f "$prd_path" ]; then
    log_err "[$label] ERROR: prd.json was not generated at $prd_path"
    return 1
  fi
  log_err "[$label] prd.json generated successfully."
  log_err "[$label] PRD contents:"
  jq '.' "$prd_path" >&2 2>/dev/null || cat "$prd_path" >&2
}

# Load ralph SKILL.md guidelines for PRD generation prompts
RALPH_SKILL_GUIDELINES=$(cat "$SCRIPT_DIR/../general/skills/ralph/SKILL.md" 2>/dev/null || echo "")
PROMPTS_DIR="$SCRIPT_DIR/eternity-loop-prompts"
if [ ! -d "$PROMPTS_DIR" ]; then
  log "WARNING: Prompts directory not found at $PROMPTS_DIR"
fi

# Helper to read a prompt file with fallback
read_prompt() {
  if [ ! -f "$PROMPTS_DIR/$1" ]; then
    log_err "WARNING: Prompt file not found: $PROMPTS_DIR/$1"
  fi
  cat "$PROMPTS_DIR/$1" 2>/dev/null || echo "# $1 (prompt file not found)"
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
  log "Settings saved to $SETTINGS_FILE"
}

# --- Setup: detect team + project with user confirmation ---

setup_linear() {
  log_err "[setup] Fetching teams and projects from Linear API..."

  local teams_result
  teams_result=$(linear_graphql '{ teams { nodes { id key name } } }')
  local teams
  teams=$(echo "$teams_result" | jq -c '[.data.teams.nodes[] | {id: .id, name: .name}]')

  local projects_result
  projects_result=$(linear_graphql '{ projects(first: 50) { nodes { id name } } }')
  local projects
  projects=$(echo "$projects_result" | jq -c '[.data.projects.nodes[] | {id: .id, name: .name}]')

  log_err "[setup] Found $(echo "$teams" | jq 'length') team(s), $(echo "$projects" | jq 'length') project(s)"

  echo "{\"teams\": $teams, \"projects\": $projects}"
}

# Interactive selection: present numbered list, return chosen value
# Usage: pick_from_list "prompt" "json_array" "id_field" "name_field"
pick_from_list() {
  local prompt="$1"
  local json_array="$2"
  local id_field="$3"
  local name_field="$4"

  local count
  count=$(echo "$json_array" | jq 'length')

  if [ "$count" -eq 0 ]; then
    log_err "ERROR: No items found."
    return 1
  fi

  echo "" >&2
  echo "$prompt" >&2
  echo "" >&2
  for i in $(seq 0 $((count - 1))); do
    local name id
    name=$(echo "$json_array" | jq -r ".[$i].$name_field")
    id=$(echo "$json_array" | jq -r ".[$i].$id_field")
    echo "  $((i + 1))) $name ($id)" >&2
  done
  echo "" >&2

  local choice
  while true; do
    read -rp "Enter number (1-$count): " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then
      local idx=$((choice - 1))
      echo "$json_array" | jq -c ".[$idx]"
      return 0
    fi
    echo "Invalid choice. Please enter a number between 1 and $count." >&2
  done
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

  # If team or project missing, fetch from Linear and ask user to choose
  if [ -z "$TEAM_ID" ] || [ -z "$PROJECT_ID" ]; then
    log "Settings incomplete. Fetching from Linear..."
    local setup_json
    setup_json=$(setup_linear)

    if [ -z "$setup_json" ]; then
      log "ERROR: Could not fetch teams/projects from Linear."
      exit 1
    fi

    # Select team
    if [ -z "$TEAM_ID" ]; then
      local teams
      teams=$(echo "$setup_json" | jq -c '.teams // []')
      local team_count
      team_count=$(echo "$teams" | jq 'length')

      if [ "$team_count" -eq 1 ]; then
        TEAM_ID=$(echo "$teams" | jq -r '.[0].id')
        local team_name
        team_name=$(echo "$teams" | jq -r '.[0].name')
        log "Auto-selected team: $team_name ($TEAM_ID)"
      else
        local chosen_team
        chosen_team=$(pick_from_list "Select a Linear team:" "$teams" "id" "name")
        TEAM_ID=$(echo "$chosen_team" | jq -r '.id')
        local team_name
        team_name=$(echo "$chosen_team" | jq -r '.name')
        log "Selected team: $team_name ($TEAM_ID)"
      fi
    fi

    # Always ask user to confirm project
    if [ -z "$PROJECT_ID" ]; then
      local projects
      projects=$(echo "$setup_json" | jq -c '.projects // []')

      local chosen_project
      chosen_project=$(pick_from_list "Select a Linear project:" "$projects" "id" "name")
      PROJECT_ID=$(echo "$chosen_project" | jq -r '.id')
      local project_name
      project_name=$(echo "$chosen_project" | jq -r '.name')
      log "Selected project: $project_name ($PROJECT_ID)"
    fi
  fi

  # Self-repair: fix working directory if missing or relative
  if [ -z "$WORK_DIR" ] || [[ "$WORK_DIR" != /* ]]; then
    WORK_DIR="$(pwd)"
    log "Working directory set to: $WORK_DIR"
  fi

  save_settings "$TEAM_ID" "$PROJECT_ID" "$WORK_DIR"
}

clean_working_tree() {
  local work_dir="$1"
  cd "$work_dir"
  log "[git] Cleaning working tree (dropping uncommitted/untracked files)..."
  git checkout -- . 2>/dev/null || true
  git clean -fd 2>/dev/null || true
  log "[git] Working tree clean."
}

ensure_main_branch() {
  local work_dir="$1"
  cd "$work_dir"
  log "[git] Ensuring main branch is up-to-date..."
  log "[git] Current branch: $(git branch --show-current)"
  clean_working_tree "$work_dir"
  git fetch origin
  git checkout --detach "origin/main" 2>/dev/null || git checkout --detach "origin/master"
  log "[git] On $(git branch --show-current), latest: $(git log -1 --format='%h %s')"
}

# --- Start task: fetch issue via Linear API, mark in progress, generate prd.json via Claude ---

start_task() {
  local team_id="$1"
  local work_dir="$2"
  local project_id="${3:-}"
  local ralph_dir="$work_dir/scripts/ralph"

  log_err "[start-task] Fetching next 'Todo' task..."
  log_err "[start-task] Team: $team_id, Project: ${project_id:-<none>}"

  # 1. Fetch Todo issues with prd label via GraphQL
  local filter
  filter=$(build_issue_filter "$team_id" "$project_id" '{"state": {"name": {"eq": "Todo"}}, "labels": {"some": {"name": {"eq": "prd"}}}}')

  local query='query($filter: IssueFilter!) {
    issues(filter: $filter, first: 1, orderBy: createdAt) {
      nodes { id identifier title description url branchName }
    }
  }'
  local variables
  variables=$(jq -n --argjson f "$filter" '{filter: $f}')
  log_err "[start-task] Querying Linear API..."
  local result
  result=$(linear_graphql "$query" "$variables")
  log_err "[start-task] Linear API response: $(echo "$result" | head -c 500)"

  local issue
  issue=$(echo "$result" | jq '.data.issues.nodes[0] // empty')
  if [ -z "$issue" ] || [ "$issue" = "null" ]; then
    log_err "[start-task] No 'Todo' issues found in Linear."
    return 1
  fi

  local issue_uuid issue_id issue_title issue_branch issue_desc issue_url
  issue_uuid=$(echo "$issue" | jq -r '.id')
  issue_id=$(echo "$issue" | jq -r '.identifier')
  issue_title=$(echo "$issue" | jq -r '.title')
  issue_branch=$(echo "$issue" | jq -r '.branchName // empty')
  issue_desc=$(echo "$issue" | jq -r '.description // ""')
  issue_url=$(echo "$issue" | jq -r '.url')
  log_err "[start-task] Found: $issue_id - $issue_title (branch: $issue_branch)"

  # 2. Update status to "In Progress" via GraphQL
  local in_progress_result
  in_progress_result=$(linear_graphql 'query($teamId: ID!) {
    teams(filter: {id: {eq: $teamId}}) {
      nodes { states { nodes { id name } } }
    }
  }' "$(jq -n --arg t "$team_id" '{teamId: $t}')")
  local in_progress_id
  in_progress_id=$(echo "$in_progress_result" | jq -r '(.data.teams.nodes[0].states.nodes // [])[] | select(.name == "In Progress") | .id')

  if [ -n "$in_progress_id" ]; then
    linear_graphql 'mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: {stateId: $stateId}) { success }
    }' "$(jq -n --arg id "$issue_uuid" --arg sid "$in_progress_id" '{id: $id, stateId: $sid}')" > /dev/null
    log_err "[start-task] Status updated to 'In Progress'"
  fi

  # 3. Generate prd.json via Claude using ralph skill guidelines
  mkdir -p "$ralph_dir"
  cd "$work_dir"
  claude --dangerously-skip-permissions --print -p "$(read_prompt create-prd.md)

Save to: $ralph_dir/prd.json
branchName: $issue_branch

## Linear Issue
- ID: $issue_id
- Title: $issue_title
- Description: $issue_desc
- Branch name: $issue_branch
- URL: $issue_url

$RALPH_SKILL_GUIDELINES" >&2 2>&1 || true

  verify_prd "$ralph_dir/prd.json" "start-task" || return 1

  echo "$issue" | jq -c '.'
  return 0
}

# --- Finalize task (create PR via Claude) ---

finalize_task() {
  local work_dir="$1"
  local issue_json="$2"
  local is_draft="$3"

  local issue_id issue_title issue_url branch_name
  parse_issue_fields "$issue_json"

  local draft_flag=""
  local status_label="ready for review"
  if [ "$is_draft" = "true" ]; then
    draft_flag="--draft"
    status_label="draft (incomplete)"
  fi

  log_err "[finalize] Creating $status_label PR for $issue_id: $issue_title"
  log_err "[finalize] Linear URL: $issue_url"

  cd "$work_dir"

  # Push the branch
  local branch
  branch=$(git branch --show-current)
  log_err "[finalize] Pushing branch $branch to origin..."
  git push -u origin "$branch" 2>/dev/null || git push origin "$branch"
  log_err "[finalize] Branch pushed. Invoking Claude to create PR..."

  claude --dangerously-skip-permissions --print -p "$(read_prompt create-pr.md)

Title: $issue_id: $issue_title
$( [ "$is_draft" = "true" ] && echo "Make it a DRAFT PR with: gh pr create --draft" || echo "Make it a regular PR with: gh pr create" )
Linear issue: $issue_url" 2>&1 | tee /dev/stderr || true

  log_err "[finalize] PR created for $issue_id."
}

# --- Review Handling: Check "In Review" issues for new PR feedback ---

# Check if a PR has new human comments since the last commit
# Checks: review comments (inline), issue comments (top-level), and review bodies
# Returns 0 if there are new comments, 1 otherwise
# Outputs the PR number on success
check_pr_has_new_human_comments() {
  local work_dir="$1"
  local branch_name="$2"

  cd "$work_dir"

  # Find the PR for this branch
  log_err "  [review-check] Looking for PR with head branch: $branch_name"
  local pr_number
  pr_number=$(gh pr list --head "$branch_name" --json number --jq '.[0].number' 2>/dev/null) || true
  if [ -z "$pr_number" ]; then
    log_err "  [review-check] No PR found for branch $branch_name"
    return 1
  fi
  log_err "  [review-check] Found PR #$pr_number for branch $branch_name"

  # Get the latest commit date on the branch
  local latest_commit_date
  latest_commit_date=$(TZ=UTC git log -1 --format="%ad" --date=format-local:'%Y-%m-%dT%H:%M:%SZ' "origin/$branch_name" 2>/dev/null) || true
  if [ -z "$latest_commit_date" ]; then
    log_err "  [review-check] Could not determine latest commit date for origin/$branch_name"
    return 1
  fi
  log_err "  [review-check] Latest commit on origin/$branch_name: $latest_commit_date"

  # Common jq filter to exclude bots (for REST API endpoints)
  local human_filter=".user.login != \"copilot\" and .user.login != \"github-actions[bot]\" and .user.type != \"Bot\""

  # Check inline review comments - only count unresolved, non-outdated threads via GraphQL
  local new_review_comments=0
  local repo_nwo
  repo_nwo=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || repo_nwo=""
  local repo_owner="${repo_nwo%%/*}"
  local repo_name="${repo_nwo##*/}"

  if [ -n "$repo_owner" ] && [ -n "$repo_name" ]; then
    new_review_comments=$(gh api graphql -f query='
      query($owner: String!, $name: String!, $pr: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
                comments(first: 50) {
                  nodes {
                    author { login }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    ' -f owner="$repo_owner" -f name="$repo_name" -F pr="$pr_number" 2>/dev/null | jq --arg cutoff "$latest_commit_date" '
      [(.data.repository.pullRequest.reviewThreads.nodes // [])[]
       | select(.isResolved == false and .isOutdated == false)
       | (.comments.nodes // [])[]
       | select(.createdAt > $cutoff and (.author.login != "copilot" and .author.login != "github-actions[bot]"))
      ] | length
    ' 2>/dev/null) || true
  fi
  log_err "  [review-check] New human inline comments (unresolved): ${new_review_comments:-0}"

  # Check top-level issue comments
  local new_issue_comments
  new_issue_comments=$(gh api "repos/{owner}/{repo}/issues/$pr_number/comments" --jq "
    [.[] | select($human_filter and .created_at > \"$latest_commit_date\")] | length
  " 2>/dev/null) || true
  log_err "  [review-check] New human top-level comments: ${new_issue_comments:-0}"

  # Check review submissions with body text
  local new_reviews
  new_reviews=$(gh api "repos/{owner}/{repo}/pulls/$pr_number/reviews" --jq "
    [.[] | select($human_filter and .body != null and .body != \"\" and .submitted_at > \"$latest_commit_date\")] | length
  " 2>/dev/null) || true
  log_err "  [review-check] New human review submissions: ${new_reviews:-0}"

  local total=$(( ${new_review_comments:-0} + ${new_issue_comments:-0} + ${new_reviews:-0} ))
  log_err "  [review-check] Total new human comments: $total"

  if [ "$total" -gt 0 ]; then
    echo "$pr_number"
    return 0
  fi
  return 1
}

# Fetch all non-resolved, non-outdated PR comments for review context
get_pr_review_comments() {
  local work_dir="$1"
  local pr_number="$2"
  local tmpdir
  tmpdir=$(mktemp -d)

  cd "$work_dir"

  log_err "  [comments] Fetching review comments for PR #$pr_number..."

  # Get review comments via GraphQL - only unresolved, non-outdated threads
  local repo_nwo
  repo_nwo=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || repo_nwo=""
  local repo_owner="${repo_nwo%%/*}"
  local repo_name="${repo_nwo##*/}"

  if [ -n "$repo_owner" ] && [ -n "$repo_name" ]; then
    gh api graphql -f query='
      query($owner: String!, $name: String!, $pr: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
                comments(first: 50) {
                  nodes {
                    databaseId
                    author { login }
                    path
                    line
                    originalLine
                    body
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    ' -f owner="$repo_owner" -f name="$repo_name" -F pr="$pr_number" 2>/dev/null | jq '
      [(.data.repository.pullRequest.reviewThreads.nodes // [])[]
       | select(.isResolved == false and .isOutdated == false)
       | (.comments.nodes // [])[]
       | select(.body | startswith("🤖 **eternity-loop bot:**") | not)
       | {
           id: .databaseId,
           author: .author.login,
           path: .path,
           line: (.line // .originalLine),
           body: .body,
           created_at: .createdAt
         }
      ]
    ' > "$tmpdir/review_comments.json" 2>/dev/null || echo "[]" > "$tmpdir/review_comments.json"
  else
    log_err "  [comments] WARNING: Could not determine repo owner/name, skipping inline review comments"
    echo "[]" > "$tmpdir/review_comments.json"
  fi

  local rc_count
  rc_count=$(jq 'length' "$tmpdir/review_comments.json" 2>/dev/null || echo 0)
  log_err "  [comments] Inline review comments (unresolved, non-outdated): $rc_count"

  # Get issue comments (top-level PR comments) - exclude bot replies
  gh api "repos/{owner}/{repo}/issues/$pr_number/comments" --jq '
    [.[] | select(.body | startswith("🤖 **eternity-loop bot:**") | not) | {
      id: .id,
      author: .user.login,
      body: .body,
      created_at: .created_at
    }]
  ' > "$tmpdir/issue_comments.json" 2>/dev/null || echo "[]" > "$tmpdir/issue_comments.json"

  local ic_count
  ic_count=$(jq 'length' "$tmpdir/issue_comments.json" 2>/dev/null || echo 0)
  log_err "  [comments] Top-level PR comments (excluding bot): $ic_count"

  # Get PR reviews with body text
  gh api "repos/{owner}/{repo}/pulls/$pr_number/reviews" --jq '
    [.[] | select(.body != null and .body != "") | {
      id: .id,
      author: .user.login,
      state: .state,
      body: .body,
      created_at: .submitted_at
    }]
  ' > "$tmpdir/reviews.json" 2>/dev/null || echo "[]" > "$tmpdir/reviews.json"

  local rv_count
  rv_count=$(jq 'length' "$tmpdir/reviews.json" 2>/dev/null || echo 0)
  log_err "  [comments] Review bodies with text: $rv_count"
  log_err "  [comments] Total comments collected: $((rc_count + ic_count + rv_count))"

  # Combine into a single JSON object
  python3 -c "
import json
rc = json.load(open('$tmpdir/review_comments.json'))
ic = json.load(open('$tmpdir/issue_comments.json'))
rv = json.load(open('$tmpdir/reviews.json'))
print(json.dumps({
  'review_comments': rc,
  'issue_comments': ic,
  'reviews': rv
}, indent=2))
"

  rm -rf "$tmpdir"
}

# Find "In Review" Linear issues that have new PR reviews
# Returns issue JSON on success, 1 on failure
check_review_tasks() {
  local team_id="$1"
  local work_dir="$2"
  local project_id="${3:-}"

  log_err "[review] Checking for 'In Review'/'In Progress' issues with new PR feedback..."

  # Fetch all prd-labeled issues via GraphQL
  local filter
  filter=$(build_issue_filter "$team_id" "$project_id" '{"labels": {"some": {"name": {"eq": "prd"}}}}')

  local query='query($filter: IssueFilter!) {
    issues(filter: $filter, first: 50) {
      nodes { id identifier title description url branchName state { name } }
    }
  }'
  local variables
  variables=$(jq -n --argjson f "$filter" '{filter: $f}')
  log_err "[review] Querying Linear API..."
  local result
  result=$(linear_graphql "$query" "$variables")
  log_err "[review] Linear API response: $(echo "$result" | head -c 500)"

  # Filter to issues with status containing "review" or "progress"
  local issues
  issues=$(echo "$result" | jq '[.data.issues.nodes[] | select(.state.name | test("review|progress"; "i"))]')

  if [ -z "$issues" ] || [ "$issues" = "[]" ] || [ "$issues" = "null" ]; then
    log_err "[review] No 'In Review'/'In Progress' issues found in Linear."
    return 1
  fi

  # Check each issue for new human PR reviews
  local count
  count=$(echo "$issues" | jq 'length')
  log_err "[review] Found $count review-candidate issue(s). Checking for new PR reviews..."

  for idx in $(seq 0 $((count - 1))); do
    local issue_json
    issue_json=$(echo "$issues" | jq -c ".[$idx]")
    local issue_id
    issue_id=$(echo "$issue_json" | jq -r '.identifier // .id')
    local issue_title
    issue_title=$(echo "$issue_json" | jq -r '.title // ""')

    log_err "[review] Checking issue $((idx + 1))/$count: $issue_id - $issue_title"

    # Find the PR for this issue by searching for the issue identifier in PR titles/branches
    cd "$work_dir"
    log_err "  [review] Searching for PR related to $issue_id..."
    local pr_json
    pr_json=$(gh pr list --state open --json number,headRefName,title --jq "
      [.[] | select(.title | ascii_downcase | contains(\"$issue_id\" | ascii_downcase))] | .[0] // empty
    " 2>/dev/null) || true

    # Fall back: search by Linear branch name if no PR found by title
    if [ -z "$pr_json" ] || [ "$pr_json" = "null" ]; then
      local linear_branch
      linear_branch=$(echo "$issue_json" | jq -r '.branchName // empty')
      if [ -n "$linear_branch" ]; then
        log_err "  [review] No PR found by title. Trying Linear branch: $linear_branch"
        pr_json=$(gh pr list --head "$linear_branch" --state open --json number,headRefName,title --jq '.[0] // empty' 2>/dev/null) || true
      fi
    fi

    if [ -z "$pr_json" ] || [ "$pr_json" = "null" ]; then
      log_err "  [review] No open PR found for $issue_id. Skipping."
      continue
    fi

    local pr_number
    pr_number=$(echo "$pr_json" | jq -r '.number')
    local branch_name
    branch_name=$(echo "$pr_json" | jq -r '.headRefName')
    local pr_title
    pr_title=$(echo "$pr_json" | jq -r '.title')
    log_err "  [review] Found PR #$pr_number: $pr_title (branch: $branch_name)"

    # Fetch remote to ensure we have latest
    log_err "  [review] Fetching origin/$branch_name..."
    if ! git fetch origin "$branch_name" 2>/dev/null; then
      log_err "  [review] Branch $branch_name not found on remote. Skipping."
      continue
    fi

    # Check for new human comments using the PR's actual branch
    local verified_pr
    verified_pr=$(check_pr_has_new_human_comments "$work_dir" "$branch_name") || {
      log_err "  [review] No new human comments for $issue_id. Skipping."
      continue
    }

    log_err "[review] >>> Found new comments on PR #$pr_number for $issue_id! Processing..."

    # Return the issue JSON augmented with pr_number and the actual PR branch
    echo "$issue_json" | jq -c ". + {\"prNumber\": $pr_number, \"branchName\": \"$branch_name\"}"
    return 0
  done

  log_err "[review] No review-candidate issues have new human PR reviews."
  return 1
}

# Generate a review-addressing prd.json from PR comments
start_review_task() {
  local work_dir="$1"
  local issue_json="$2"
  local ralph_dir="$work_dir/scripts/ralph"

  local issue_id issue_title issue_url branch_name
  parse_issue_fields "$issue_json"
  local pr_number
  pr_number=$(printf '%s' "$issue_json" | jq -r '.prNumber')

  log_err "[start-review] Generating review-addressing PRD for $issue_id (PR #$pr_number)..."
  log_err "[start-review] Issue: $issue_title"
  log_err "[start-review] Branch: $branch_name"
  log_err "[start-review] URL: $issue_url"

  mkdir -p "$ralph_dir"

  # Collect all non-outdated PR comments
  log_err "[start-review] Collecting PR comments..."
  local comments
  comments=$(get_pr_review_comments "$work_dir" "$pr_number")
  log_err "[start-review] PR comments collected."

  # Clean working tree and check out the branch
  clean_working_tree "$work_dir"
  log_err "[start-review] Checking out branch $branch_name..."
  if ! git checkout "$branch_name" 2>/dev/null; then
    log_err "[start-review] Branch $branch_name not found locally, creating from origin..."
    git checkout -b "$branch_name" "origin/$branch_name" || {
      log_err "[start-review] ERROR: Could not check out branch $branch_name"
      return 1
    }
  fi
  git pull origin "$branch_name" --ff-only 2>/dev/null || true
  log_err "[start-review] On branch: $(git branch --show-current), latest commit: $(git log -1 --format='%h %s')"
  log_err "[start-review] Invoking Claude to generate review prd.json..."

  claude --dangerously-skip-permissions --print -p "$(read_prompt create-review-prd.md)

Save to: $ralph_dir/prd.json
branchName: $branch_name
project: \"$issue_id: $issue_title (review feedback)\"

## Linear Issue (for context only)
- ID: $issue_id
- Title: $issue_title
- URL: $issue_url

## PR #$pr_number Review Comments

$comments

$RALPH_SKILL_GUIDELINES" 2>&1 | tee /dev/stderr || true

  verify_prd "$ralph_dir/prd.json" "start-review" || return 1
  return 0
}

# --- Main Loop ---

# Suppress notifications in child processes
export DISABLE_PUSHOVER_NOTIFICATIONS=true
export RALPH_LOOP=true

log "============================================="
log "  Ralph Linear Loop"
log "  Tool: $TOOL | Max iterations: $MAX_ITERATIONS"
log "============================================="

ensure_settings

TEAM_ID=$(get_setting "teamId")
PROJECT_ID=$(get_setting "projectId")
WORK_DIR=$(get_setting "workingDirectory")

if [ -z "$TEAM_ID" ] || [ -z "$WORK_DIR" ]; then
  log "ERROR: Missing teamId or workingDirectory in $SETTINGS_FILE"
  exit 1
fi

log "Team: $TEAM_ID"
[ -n "$PROJECT_ID" ] && log "Project: $PROJECT_ID"
log "Working directory: $WORK_DIR"
echo ""

while true; do
  LOOP_START=$(date +%s)
  log ""
  log "-----------------------------------------------"
  log "  Loop iteration started"
  log "-----------------------------------------------"

  TASK_TYPE=""
  ISSUE_JSON=""
  ISSUE_ID=""
  BRANCH_NAME=""

  # --- Priority 1: Check for "In Review" issues with new PR reviews ---
  log "[loop] Priority 1: Checking for issues with new PR reviews..."
  REVIEW_JSON=""
  set +e
  REVIEW_JSON=$(check_review_tasks "$TEAM_ID" "$WORK_DIR" "$PROJECT_ID")
  REVIEW_EXIT=$?
  set -e
  log "[loop] check_review_tasks exited with status $REVIEW_EXIT"

  if [ -n "$REVIEW_JSON" ]; then
    TASK_TYPE="review"
    ISSUE_JSON="$REVIEW_JSON"
    log "[loop] Review JSON received ($(printf '%s' "$ISSUE_JSON" | wc -c | tr -d ' ') bytes)"
    set +e
    parse_issue_fields "$ISSUE_JSON"
    PARSE_EXIT=$?
    set -e
    if [ "$PARSE_EXIT" -ne 0 ]; then
      log "[loop] ERROR: parse_issue_fields failed with status $PARSE_EXIT. Skipping..."
      sleep "$POLL_INTERVAL"
      continue
    fi
    ISSUE_ID="$issue_id"
    BRANCH_NAME="$branch_name"
    PR_NUMBER=$(echo "$ISSUE_JSON" | jq -r '.prNumber')
    log "[loop] Parsed review task: issue=$ISSUE_ID branch=$BRANCH_NAME pr=#$PR_NUMBER"

    log ""
    log "============================================="
    log "  Addressing PR review: $ISSUE_ID (PR #$PR_NUMBER)"
    log "  Branch: $BRANCH_NAME"
    log "============================================="

    # Checkout the existing branch and generate review prd.json
    cd "$WORK_DIR"
    log "[loop] Starting review task..."
    start_review_task "$WORK_DIR" "$ISSUE_JSON" || {
      log "[loop] Failed to generate review PRD. Skipping..."
      sleep "$POLL_INTERVAL"
      continue
    }
    log "[loop] Review task PRD generated successfully."
  fi

  # --- Priority 2: Check for new "Todo" issues ---
  if [ -z "$TASK_TYPE" ]; then
    log "[loop] No review tasks found. Priority 2: Checking for 'Todo' issues..."

    ISSUE_JSON=$(start_task "$TEAM_ID" "$WORK_DIR" "$PROJECT_ID") || true

    if [ -z "$ISSUE_JSON" ]; then
      log "[loop] No tasks found (review or todo). Polling again in ${POLL_INTERVAL}s..."
      sleep "$POLL_INTERVAL"
      continue
    fi

    # Start from clean main branch for new tasks
    ensure_main_branch "$WORK_DIR"

    TASK_TYPE="new"
    parse_issue_fields "$ISSUE_JSON"
    ISSUE_ID="$issue_id"
    BRANCH_NAME="$branch_name"

    log ""
    log "============================================="
    log "  Starting task: $ISSUE_ID"
    log "  Branch: $BRANCH_NAME"
    log "============================================="

    # Create/checkout the feature branch
    cd "$WORK_DIR"
    log "[loop] Creating/checking out branch: $BRANCH_NAME"
    git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
    log "[loop] On branch: $(git branch --show-current)"
  fi

  # Write project-specific CLAUDE.md that tells Ralph NOT to manage branches
  # (branch management is handled by this script)
  ralph_dir="$WORK_DIR/scripts/ralph"
  mkdir -p "$ralph_dir"
  # Copy ralph CLAUDE.md with branch override (step 3 changed from upstream)
  cp "$PROMPTS_DIR/ralph-claude-md.md" "$ralph_dir/CLAUDE.md"
  log "[loop] Wrote scripts/ralph/CLAUDE.md (branch override)"

  # Run ralph-loop.sh from the project directory
  log ""
  log "[loop] Starting ralph-loop.sh (tool: $TOOL, max iterations: $MAX_ITERATIONS, task type: $TASK_TYPE)..."
  log "[loop] Working directory: $WORK_DIR"
  log "[loop] Current branch: $(cd "$WORK_DIR" && git branch --show-current)"
  RALPH_EXIT=0
  CLAUDE_PROJECT_DIR="$WORK_DIR" "$SCRIPT_DIR/ralph-loop.sh" --tool "$TOOL" "$MAX_ITERATIONS" || RALPH_EXIT=$?
  log "[loop] ralph-loop.sh exited with status: $RALPH_EXIT"

  # Finalize based on task type and exit status
  if [ "$TASK_TYPE" = "review" ]; then
    # For review tasks: push updates to the existing PR
    cd "$WORK_DIR"
    log "[loop] Pushing review fixes to origin..."
    git push origin "$(git branch --show-current)" 2>/dev/null || true
    log "[loop] Pushed review fixes to PR #$PR_NUMBER."

    # Reply to each PR comment explaining how it was addressed
    log "[loop] Replying to PR comments on PR #$PR_NUMBER..."
    local review_comments
    review_comments=$(get_pr_review_comments "$WORK_DIR" "$PR_NUMBER")
    claude --dangerously-skip-permissions --print -p "$(sed "s/PR_NUMBER/$PR_NUMBER/g" "$PROMPTS_DIR/reply-to-pr-comments.md")

## PR #$PR_NUMBER Review Comments
$review_comments

## Recent commits addressing this feedback
$(cd "$WORK_DIR" && git log --oneline -20)" 2>&1 | tee /dev/stderr || true
    log "[loop] Finished replying to PR comments."
  else
    # For new tasks: create PR based on exit status
    if [ "$RALPH_EXIT" -eq 0 ]; then
      log "[loop] Ralph completed successfully. Creating PR..."
      finalize_task "$WORK_DIR" "$ISSUE_JSON" "false"
    else
      log "[loop] Ralph exited with status $RALPH_EXIT. Creating draft PR..."
      finalize_task "$WORK_DIR" "$ISSUE_JSON" "true"
    fi
  fi

  LOOP_END=$(date +%s)
  LOOP_DURATION=$(( LOOP_END - LOOP_START ))
  log ""
  log "[loop] Task $ISSUE_ID ($TASK_TYPE) complete in ${LOOP_DURATION}s. Moving to next task..."
  log ""
done
