#!/bin/bash

echo "Setting up Bun environment..."

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Try to get BUN_VERSION from multiple sources (fail gracefully)
BUN_VERSION=""

# 1. Try .bun-version file
if [ -f "$PROJECT_DIR/.bun-version" ]; then
  BUN_VERSION=$(cat "$PROJECT_DIR/.bun-version" | tr -d '[:space:]')
  echo "📄 Found BUN_VERSION from .bun-version: $BUN_VERSION"
fi

# 2. Try package.json packageManager field
if [ -z "$BUN_VERSION" ] && [ -f "$PROJECT_DIR/package.json" ]; then
  # Extract bun version from "packageManager": "bun@1.2.3"
  PACKAGE_MANAGER=$(grep -o '"packageManager"[[:space:]]*:[[:space:]]*"bun@[^"]*"' "$PROJECT_DIR/package.json" 2>/dev/null || echo "")
  if [ -n "$PACKAGE_MANAGER" ]; then
    BUN_VERSION=$(echo "$PACKAGE_MANAGER" | sed 's/.*bun@\([^"]*\).*/\1/')
    echo "📦 Found BUN_VERSION from package.json packageManager: $BUN_VERSION"
  fi
fi

# 3. Try .env.github file
if [ -z "$BUN_VERSION" ] && [ -f "$PROJECT_DIR/.env.github" ]; then
  ENV_VERSION=$(grep -E '^BUN_VERSION=' "$PROJECT_DIR/.env.github" 2>/dev/null | cut -d'=' -f2 | tr -d '[:space:]"'"'" || echo "")
  if [ -n "$ENV_VERSION" ]; then
    BUN_VERSION="$ENV_VERSION"
    echo "🔧 Found BUN_VERSION from .env.github: $BUN_VERSION"
  fi
fi

# 4. Check if already set in environment
if [ -z "$BUN_VERSION" ] && [ -n "${BUN_VERSION:-}" ]; then
  echo "🌍 Using BUN_VERSION from environment: $BUN_VERSION"
fi

check_bun_not_installed() {
  if command -v bun >/dev/null 2>&1; then
    local installed
    installed=$(bun --version | awk '{print $1}')

    if [ -z "$BUN_VERSION" ]; then
      echo "✅ Found bun version $installed (no specific version required)"
      return 1
    fi

    # If version matches exactly
    if [ "$installed" = "$BUN_VERSION" ]; then
      echo "✅ Found bun version $installed (required: $BUN_VERSION). Skipping installation."
      return 1
    else
      echo "⚠️ Found bun version $installed but recommended is $BUN_VERSION."
      if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
        return 1
      fi
      return 0
    fi
  else
    echo "🔍 bun not found in PATH."
    if [ -z "$BUN_VERSION" ]; then
      echo "⚠️ No BUN_VERSION specified and bun not installed. Skipping."
      return 1
    fi
    return 0
  fi
}

if check_bun_not_installed; then
  echo "🎯 Installing Bun version: $BUN_VERSION"
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
  echo "✅ Bun installation complete"
  bun --version
fi

# Only run install if node_modules doesn't exist
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "📦 Running bun install (node_modules not found)..."
  cd "$PROJECT_DIR" && bun install
else
  echo "✅ Skipping bun install (node_modules already exists)"
fi

# Only run codegen if the script exists in package.json
if [ -f "$PROJECT_DIR/package.json" ]; then
  HAS_CODEGEN=$(grep -o '"codegen"[[:space:]]*:' "$PROJECT_DIR/package.json" 2>/dev/null || echo "")
  if [ -n "$HAS_CODEGEN" ]; then
    echo "🔄 Running codegen..."
    cd "$PROJECT_DIR" && bun run codegen
  else
    echo "✅ Skipping codegen (no codegen script in package.json)"
  fi
fi

echo "✅ Bun environment setup complete"

exit 0
