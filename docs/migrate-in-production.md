# The migration in a production image

Why `npm run db:migrate` failed on Railway with `ERR_MODULE_NOT_FOUND`, what the
runtime image actually contains, and what the migration needs to run there. The
fix itself is described in `README.md` under **Deploying**; this page is the
inventory the fix is built on.

## The failure

Railway runs the pre-deploy command inside the service image, and that image
installs **production dependencies only** (`npm ci --omit=dev`). `dotenv` is a
`devDependency`, and `scripts/migrate.ts` imported it, so the pre-deploy step
died before it ever reached the database. The same class of failure was waiting
behind it: the script was TypeScript run through Node's type stripping, the
migrations folder was resolved from the current working directory, and the
platform never proved any of it because the image is assembled by a Dockerfile
that nothing in CI built.

## What the runtime image contains

The `runner` stage of the `Dockerfile`, before this fix:

| Path                                                   | Why it was there                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `.next/standalone/` (including its own `node_modules`) | the Next.js server that serves traffic                                  |
| `.next/static/`, `public/`                             | the assets it serves                                                    |
| `node_modules/` from `npm ci --omit=dev`               | production dependencies, intended for the migration                     |
| `drizzle/`                                             | the SQL migrations and `meta/_journal.json`                             |
| `scripts/`, `src/server/config/`, `src/server/db/`     | the TypeScript sources the migration imports                            |
| `package.json`, `tsconfig.json`                        | so `npm run db:migrate` and Node's type stripping had something to read |

Base image `node:24-alpine`, `NODE_ENV=production`, `PORT=3000`,
`HOSTNAME=0.0.0.0`, running as the non-root user `nextjs` (uid 1001). No secret
is ever copied in; every value arrives as an environment variable.

## What the migration needs

The module graph of `scripts/migrate.ts` was four files:

```
scripts/migrate.ts
├── src/server/config/env.ts   → zod            (production dependency)
├── src/server/db/ssl.ts       → pg (types)     (production dependency)
└── src/server/db/migrate.ts   → drizzle-orm, pg (production dependencies)
    └── drizzle/               → 0000_baseline.sql, 0001_accounts.sql, meta/_journal.json
```

So the runtime requirements are: a Node.js runtime, three production packages
(`zod`, `pg`, `drizzle-orm`), the SQL folder with its journal, and the code that
drives them. Everything else it was reaching for, it did not need:

- `dotenv` — a `devDependency`, and unnecessary: Node has `process.loadEnvFile`.
- `tsx` — never used; `node --experimental-strip-types` ran the TypeScript.
- `drizzle-kit` — needed to **generate** SQL during development, never to apply it.
- `typescript` — not needed to run code whose types are stripped.

Node 24 is what the image runs, and `.nvmrc` and `engines` pin `>=24 <25`.
`process.loadEnvFile` arrived in Node **20.12**, so both the image and a
developer's machine can rely on it.

## The approach

The migration is **bundled at image build time** into one JavaScript file,
`dist/migrate.mjs`, with its dependencies inlined, and that file plus `drizzle/`
is copied into the runtime image. The alternative — keeping production
`node_modules` in the image and compiling the script — was rejected because it
leaves the two failure modes that caused this bug: a runtime that silently
depends on a package installed at build time, and a package that turns out to be
a `devDependency` only at deploy time. A bundle either contains what it needs or
fails at build time, which is a place CI can see it.
