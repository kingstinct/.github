#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env file if present
if [ -f "$SCRIPT_DIR/../.env.github" ]; then
  # export variables from .env (simple version)
  export $(grep -v '^#' "$SCRIPT_DIR/../.env.github" | xargs)
fi

# Check if required environment variables are set
if [ -z "${PUSHOVER_API_TOKEN:-}" ] || [ -z "${PUSHOVER_USER_KEY:-}" ]; then
  echo "⚠️ Pushover credentials not configured. Skipping notification."
  exit 0
fi

TITLE="${TITLE:-Claude Code}"

# Determine message based on whether running remotely
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  MESSAGE="${MESSAGE:-Open Claude Code session}"
  URL="https://claude.ai/code"
  URL_TITLE="Open Claude"

  curl -s \
    -F "token=$PUSHOVER_API_TOKEN" \
    -F "user=$PUSHOVER_USER_KEY" \
    -F "message=$MESSAGE" \
    -F "url=$URL" \
    -F "url_title=$URL_TITLE" \
    -F "title=$TITLE" \
    https://api.pushover.net/1/messages.json
else
  MESSAGE="${MESSAGE:-Claude Code is done! Time to return from coffee break}"

  curl -s \
    -F "token=$PUSHOVER_API_TOKEN" \
    -F "user=$PUSHOVER_USER_KEY" \
    -F "message=$MESSAGE" \
    -F "title=$TITLE" \
    https://api.pushover.net/1/messages.json
fi

exit 0
