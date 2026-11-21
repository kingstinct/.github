#!/usr/bin/env bash
# Runs a CapRover CLI command, retrying while the server is busy.
#
# CapRover handles one operation at a time and rejects others with errors like
# "Another operation is in process for Certbot" or "system not ready yet".
#
# Usage: caprover-retry.sh <command...>
# Env:
#   CAPROVER_RETRY_ATTEMPTS  max attempts (default 8)
#   CAPROVER_RETRY_OK        extended regex of errors that count as success,
#                            e.g. "App Name already exists" for idempotent registers
set -uo pipefail

attempts="${CAPROVER_RETRY_ATTEMPTS:-8}"
ok_pattern="${CAPROVER_RETRY_OK:-}"
busy_pattern='Another operation is in process|not ready yet|currently in a building process|Too many requests'

for attempt in $(seq 1 "$attempts"); do
  output=$("$@" 2>&1)
  status=$?
  echo "$output"

  if [ "$status" -eq 0 ] && ! grep -q "Something bad happened" <<<"$output"; then
    exit 0
  fi

  if [ -n "$ok_pattern" ] && grep -Eq "$ok_pattern" <<<"$output"; then
    echo "Treating as success (matches CAPROVER_RETRY_OK)"
    exit 0
  fi

  if ! grep -Eq "$busy_pattern" <<<"$output"; then
    echo "::error::CapRover command failed: $*"
    exit 1
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    delay=$((attempt * 10 + RANDOM % 20))
    echo "CapRover is busy (attempt $attempt/$attempts), retrying in ${delay}s..."
    sleep "$delay"
  fi
done

echo "::error::CapRover was still busy after $attempts attempts: $*"
exit 1
