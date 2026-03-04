# Publishing to GitHub Marketplace

This guide covers how to publish Skill Lint as a GitHub Marketplace Action.

## Prerequisites

- The repository must be **public**
- `action.yml` must be in the repository root with `name`, `description`, `branding` fields
- `dist/` must be committed (it contains the bundled action code)

## First-time Setup

### 1. Make the repository public

Go to **Settings > General > Danger Zone > Change repository visibility** and set it to public.

### 2. Verify action.yml

Ensure `action.yml` has the required Marketplace fields:

```yaml
name: "Skill Lint"
description: "Evaluate, benchmark, and refine agent skills..."
author: "nkootstra"
branding:
  icon: "check-circle"
  color: "blue"
```

### 3. Build dist/

```bash
npm ci
npm run build
git add dist/
git commit -m "build: update dist/"
```

## Creating a Release

### 1. Tag a version

```bash
git tag -a v1.0.0 -m "v1.0.0 — Initial release"
git push origin v1.0.0
```

### 2. Create a GitHub Release

1. Go to **Releases > Draft a new release**
2. Select the tag you just pushed (e.g., `v1.0.0`)
3. Check **"Publish this Action to the GitHub Marketplace"**
4. Select the **Primary Category** (e.g., "Code quality") and optionally a secondary one
5. Fill in the release title and notes
6. Click **Publish release**

The release workflow will automatically update the major version tag (`v1`) to point to this release, so users can pin to `nkootstra/skill-lint@v1`.

### 3. Verify on Marketplace

After publishing, your action will be visible at:
`https://github.com/marketplace/actions/skill-lint`

## Releasing Updates

For subsequent releases:

```bash
# Make your changes
npm run build
git add dist/
git commit -m "build: update dist/"
git push

# Tag and release
git tag -a v1.1.0 -m "v1.1.0 — Description of changes"
git push origin v1.1.0
```

Then create a GitHub Release from the tag (with the Marketplace checkbox).

## Version Strategy

Follow semver:

| Change | Version bump | Example |
|--------|-------------|---------|
| Bug fixes, docs | Patch | v1.0.0 → v1.0.1 |
| New features, new rules | Minor | v1.0.0 → v1.1.0 |
| Breaking config changes | Major | v1.0.0 → v2.0.0 |

Users reference the action as:

```yaml
# Pin to major version (recommended — gets minor/patch updates)
- uses: nkootstra/skill-lint@v1

# Pin to exact version
- uses: nkootstra/skill-lint@v1.0.0

# Always latest (not recommended for production)
- uses: nkootstra/skill-lint@main
```

## Marketplace Categories

Good categories for Skill Lint:

- **Primary**: Code quality
- **Secondary**: Testing or Continuous integration

## Updating the Marketplace Listing

The Marketplace listing is derived from:

- **Title**: `name` field in `action.yml`
- **Description**: `description` field in `action.yml`
- **Icon/Color**: `branding` in `action.yml`
- **README**: Displayed as the full listing page
- **Release notes**: Shown on the version page
