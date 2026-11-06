# CI

## Status

`.github/workflows/ci.yml` is the workflow and it is committed. It runs two jobs on every
pull request and every push to `main`:

| Job       | What it proves                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `verify`  | install, lint, typecheck, unit tests, database tests against a real Postgres service container, production build |
| `secrets` | gitleaks over the **full history**, because a credential in an old commit is still a live credential             |

Keep the two files separate in your head: **this document explains the workflow, the
`.yml` file is the workflow.** A previous version of `ci.yml` contained this markdown by
mistake, which made every run fail at startup with zero jobs. If that ever happens again,
the symptom is a run with no jobs and no logs.

The YAML below is the same content, kept here so the file can be restored by copy and
paste. GitHub only allows an OAuth app to write a workflow file with the `workflow`
scope, so if a future connection lacks it, the fix is a manual paste of this block.

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

## Secret scanning (paste this into the workflow)

A credential once reached `package.json` in this repository. Removing it does not remove it from history, so CI now needs to fail the build when a secret appears in a **new** commit. This job is deliberately separate from the main `verify` job: it runs on the whole history, and it is fast, so it reports first.

Add it to `.github/workflows/ci.yml` as a second job (adjust the indentation to match the file):

```yaml
secrets:
  name: secret scan
  runs-on: ubuntu-latest
  timeout-minutes: 10
  permissions:
    contents: read
  steps:
    - name: Checkout
      uses: actions/checkout@v4
      with:
        # Full history: a secret in an old commit is still a live secret.
        fetch-depth: 0

    - name: gitleaks
      uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes for the owner:

- `fetch-depth: 0` matters. With the default shallow clone, gitleaks only sees the last commit and reports a clean history that is not clean.
- The job **fails the build** on a finding. Do not add `continue-on-error`: a red build is the point.
- To scan the history once, before enabling it, run `gitleaks detect --source . --redact --verbose` locally and read the **path and line** it reports. Never paste a finding's value anywhere.
- Add `.gitleaks.toml` only to allow-list a **known false positive**, with a comment saying which rule and why. Never to allow-list a real key.

## What it runs

Install, lint, typecheck, unit tests, database tests against a real Postgres service
container, and a production build. Any failure fails the job. Dependencies are cached
through `actions/setup-node` with `cache: npm`, and the Node version comes from `.nvmrc`
so CI and a developer's machine cannot drift.

## Suggested additions for the portability work (paste into `.github/workflows/ci.yml`)

The app is not allowed to write workflow files (see the note at the top of this
file), so these steps are kept here for the owner to paste in. They extend the
existing `verify` job.

### 1. Prove the container builds

```yaml
- name: Build the image
  run: docker build -t street-boys-web:ci .

- name: The image answers liveness without a database
  run: |
    docker run -d --name smoke -p 3000:3000 \
      -e DATABASE_URL=postgresql://streetboys:streetboys@127.0.0.1:5432/streetboys_test \
      street-boys-web:ci
    for i in $(seq 1 30); do
      curl -fsS http://127.0.0.1:3000/api/health && break
      sleep 2
    done
    curl -fsS http://127.0.0.1:3000/api/health
    docker rm -f smoke
```

### 2. Smoke-test the standalone server without Docker

Faster than building an image, and it catches a broken standalone output on every
pull request:

```yaml
- name: Standalone server smoke test
  env:
    DATABASE_URL: postgresql://streetboys:streetboys@127.0.0.1:5432/streetboys_test
    CRON_SECRET: ci-only-secret-value
  run: |
    npm run build
    cp -r public .next/standalone/
    cp -r .next/static .next/standalone/.next/
    (cd .next/standalone && PORT=3000 HOSTNAME=127.0.0.1 node server.js &) 
    for i in $(seq 1 30); do
      curl -fsS http://127.0.0.1:3000/api/health && break
      sleep 2
    done
    curl -fsS http://127.0.0.1:3000/api/health
    curl -fsS http://127.0.0.1:3000/api/ready
```

### 3. Prove the migration is idempotent

```yaml
- name: Migrations can run twice
  env:
    DATABASE_URL: postgresql://streetboys:streetboys@127.0.0.1:5432/streetboys_test
  run: |
    npm run db:migrate
    npm run db:migrate
```
