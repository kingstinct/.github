# Kingstinct Organization-Wide GitHub Configuration

This repository contains shared GitHub Actions, workflow templates, and organization-wide configurations for the Kingstinct organization.

## Claude Code Skills Marketplace

This repo hosts a Claude Code skills marketplace with curated plugins for Expo, React Native, SQL, and document processing.

### Installation

```bash
# Add the marketplace
/plugin marketplace add kingstinct/.github/skills

# Install the plugins you need
/plugin install expo-skills@kingstinct-skills
/plugin install callstack-skills@kingstinct-skills
/plugin install anthropic-skills@kingstinct-skills
/plugin install kysely-sql@kingstinct-skills
/plugin install typescript@kingstinct-skills
/plugin install biome@kingstinct-skills
/plugin install general@kingstinct-skills
/plugin install bun@kingstinct-skills
```

### Available Plugins

#### External Plugins

| Plugin | Source | Description |
|--------|--------|-------------|
| `expo-skills` | [expo/skills](https://github.com/expo/skills) | App design, SDK upgrades, and deployment to App Store/Play Store/web |
| `callstack-skills` | [callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills) | React Native best practices, performance optimization, and GitHub workflows |
| `anthropic-skills` | [anthropics/skills](https://github.com/anthropics/skills) | Document processing (Excel, Word, PowerPoint, PDF) and example skills |

#### Kingstinct Plugins

| Plugin | Description | Hooks |
|--------|-------------|-------|
| `kysely-sql` | SQL with Kysely (expo-sqlite / bun:sqlite) | - |
| `typescript` | Strict TypeScript best practices | `bun run typecheck` on Edit/Write |
| `biome` | Auto-format and lint with Biome | `biome check --fix` on Edit/Write |
| `bun` | Bun setup: install version from .bun-version/package.json/.env.github, run codegen | SessionStart |
| `general` | Git commands, Linear integration, Pushover notifications | Session hooks + /commit, /push, /amend, /start-linear-task |

### Updating

```bash
/plugin marketplace update kingstinct-skills
```

Updates are pulled automatically from the upstream sources.

## Reusable Actions

The following composite actions are available for use across all repositories in the organization:

### Docker Build and Push

Builds a Docker image and pushes it to GitHub Container Registry.

```yaml
- uses: kingstinct/.github/actions/docker-build@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    image-name: 'ghcr.io/kingstinct/my-app'  # optional
    build-args: 'ARG1=value1'                 # optional
    context: '.'                              # optional
    dockerfile: 'Dockerfile'                  # optional
```

### CapRover Deploy

Deploys a Docker image to CapRover.

```yaml
- uses: kingstinct/.github/actions/caprover-deploy@main
  with:
    caprover-url: ${{ secrets.CAPROVER_URL }}
    caprover-password: ${{ secrets.CAPROVER_PASSWORD }}
    caprover-app: 'my-app'
    image-name: 'ghcr.io/kingstinct/my-app:${{ github.sha }}'
    bun-version: '1.3.8'  # optional
```

### Health Check

Checks the health of a deployed service with retries and optional Discord notifications.

```yaml
- uses: kingstinct/.github/actions/healthcheck@main
  with:
    url: 'https://my-app.example.com/health'
    max-attempts: '24'           # optional, default: 24
    retry-delay: '5s'            # optional, default: 5s
    discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}  # optional
```

## Workflow Templates

Workflow templates are available in the `workflow-templates/` directory. These appear in the "Actions" tab when creating new workflows in organization repositories.

## Usage

To use these actions in your workflows, reference them with the full path:

```yaml
uses: kingstinct/.github/actions/<action-name>@main
```

You can also pin to a specific commit SHA for stability:

```yaml
uses: kingstinct/.github/actions/<action-name>@<commit-sha>
```
