# Kingstinct Organization-Wide GitHub Configuration

This repository contains shared GitHub Actions, workflow templates, and organization-wide configurations for the Kingstinct organization.

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
