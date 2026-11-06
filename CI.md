# CI

**Purpose:** The CI workflow that must run on every pull request and every push to `main`, and the one step needed to switch it on.
**Status:** Written and reviewed here; the workflow file itself is **not yet committed**. Action needed from the owner (see below).

## Why this README exists

`ci.yml` could not be pushed from the agent's GitHub connection. The connected OAuth app
holds only the `repo` scope, and GitHub refuses any write to a workflow file without the
`workflow` scope:

```
refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope
```

Nothing was worked around. The exact workflow is kept below, in full, so that it is
reviewable in this pull request.

## To switch CI on, either

1. Reconnect the GitHub account with the **workflow** scope (Settings → connected accounts → GitHub → grant `workflow`), then move the block below into `.github/workflows/ci.yml`; or
2. Save the block below as `.github/workflows/ci.yml` yourself and push it.

Then confirm the `name: CI` workflow appears under the Actions tab, and that it runs on the next pull request.

## `ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

# A new push to the same branch cancels the run in flight: the old result is stale.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  verify:
    name: lint, typecheck, test, build
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: streetboys
          POSTGRES_PASSWORD: streetboys
          POSTGRES_DB: streetboys_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U streetboys -d streetboys_test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      # Test-only credentials for the throwaway service container above.
      DATABASE_URL: postgresql://streetboys:streetboys@127.0.0.1:5432/streetboys_test
      DATABASE_URL_TEST: postgresql://streetboys:streetboys@127.0.0.1:5432/streetboys_test
      NEXT_TELEMETRY_DISABLED: '1'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Unit tests
        run: npm run test

      - name: Database tests (migrations against a real Postgres)
        run: npm run test:db

      - name: Build
        run: npm run build
```

## What it runs

Install, lint, typecheck, unit tests, database tests against a real Postgres service
container, and a production build. Any failure fails the job. Dependencies are cached
through `actions/setup-node` with `cache: npm`, and the Node version comes from `.nvmrc`
so CI and a developer's machine cannot drift.
