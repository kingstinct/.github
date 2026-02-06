---
description: Biome linting and formatting guidelines
---

# Biome Guidelines

Biome is used for linting and formatting. The PostToolUse hook automatically runs `biome check --fix` on file changes.

## Fix Warnings Too

When modifying files, fix both errors AND warnings reported by Biome. Don't leave warnings behind.

After editing a file:
1. Check if Biome reported any warnings
2. Fix them before moving on
3. Run `bunx biome check <file>` to verify

## Manual Commands

```bash
# Check a specific file
bunx biome check path/to/file.ts

# Check and fix a file
bunx biome check --fix path/to/file.ts

# Check entire project
bunx biome check .

# Format only (no linting)
bunx biome format --write path/to/file.ts

# Lint only (no formatting)
bunx biome lint path/to/file.ts
```

## Common Issues to Fix

- Unused imports and variables
- Missing semicolons or extra semicolons (per project config)
- Inconsistent quotes
- Trailing commas
- Unsafe operations (use `--unsafe` flag when appropriate)
- Accessibility issues in JSX

## Configuration

Biome config is in `biome.json` or `biome.jsonc` at project root. Respect project-specific rules.
