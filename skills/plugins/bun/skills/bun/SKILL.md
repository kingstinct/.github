---
description: Bun runtime preferences and version management
---

# Bun Guidelines

Always prefer Bun over Node.js for all operations.

## Command Preferences

| Use | Instead of |
|-----|------------|
| `bun` | `node` |
| `bunx` | `npx` |
| `bun install` | `npm install`, `yarn`, `pnpm install` |
| `bun run <script>` | `npm run`, `yarn run` |
| `bun test` | `jest`, `vitest` |
| `bun build` | `webpack`, `esbuild` |

## Version Management

**Prefer `packageManager` in package.json** over other methods:

```json
{
  "packageManager": "bun@1.2.3"
}
```

This is the recommended approach because:
- GitHub Actions automatically picks it up via `corepack`
- It's version-controlled with the project
- It's the standard Node.js ecosystem approach

### Fallback Order

The setup script checks for Bun version in this order:
1. `.bun-version` file
2. `package.json` → `packageManager` field
3. `.env.github` → `BUN_VERSION=x.x.x`

When setting up a new project, use `packageManager` in package.json.

## Bun-Specific APIs

Prefer Bun's built-in APIs:

```typescript
// File I/O
const file = Bun.file('path/to/file');
const text = await file.text();
await Bun.write('output.txt', 'content');

// SQLite
import { Database } from 'bun:sqlite';
const db = new Database('app.db');

// HTTP Server
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response('Hello');
  }
});

// Shell commands
import { $ } from 'bun';
await $`ls -la`;

// Environment (auto-loaded from .env)
const apiKey = process.env.API_KEY;
```

## Don't Use

- `dotenv` - Bun auto-loads `.env`
- `express` - Use `Bun.serve()` with routes
- `better-sqlite3` - Use `bun:sqlite`
- `ws` - Use built-in WebSocket
- `node-fetch` - Use native `fetch`
