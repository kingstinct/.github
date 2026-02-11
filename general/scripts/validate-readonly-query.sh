#!/bin/bash
# Blocks SQL/MongoDB write operations, allows read-only queries

# Read JSON input from stdin
INPUT=$(cat)

# Extract the command field from tool_input using jq
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block SQL write operations (case-insensitive)
if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b' > /dev/null; then
  echo "Blocked: SQL write operations not allowed. Use SELECT queries only." >&2
  exit 2
fi

# Block MongoDB write operations
if echo "$COMMAND" | grep -E '\.(insert|update|delete|remove|drop|createCollection|createIndex|dropIndex|renameCollection|replaceOne|updateOne|updateMany|deleteOne|deleteMany|insertOne|insertMany|findOneAndDelete|findOneAndReplace|findOneAndUpdate|bulkWrite)\s*\(' > /dev/null; then
  echo "Blocked: MongoDB write operations not allowed. Use find/aggregate queries only." >&2
  exit 2
fi

exit 0
