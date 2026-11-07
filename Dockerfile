# syntax=docker/dockerfile:1
#
# One Dockerfile, three platforms.
#
#   deps     installs every dependency, including the dev ones the build needs
#   build    compiles Next.js (`output: "standalone"`) and bundles the migration
#   runner   the shipped image: non-root, PORT from the environment, no secrets
#
# The migration is a **pre-deploy** command that a platform runs inside this
# image, so the image has to be able to run it with production dependencies only.
# It used to fail there with `ERR_MODULE_NOT_FOUND`, because the script imported
# `dotenv` (a devDependency) and spoke TypeScript. It is now bundled to
# `dist/migrate.mjs` at image build time with its dependencies inlined, so the
# runner copies two things for it: the bundle and the SQL.
#
# That is also why there is no `npm ci --omit=dev` in the runner: nothing in the
# shipped image installs from the registry, so no runtime package can be missing
# and no devDependency can sneak into it. `docs/migrate-in-production.md` records
# the reasoning.
#
# No secret is ever baked in: every value arrives as an environment variable.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# The pre-deploy migration, as one self-contained JavaScript file.
RUN npm run build:migrate

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# The standalone server brings its own traced `node_modules`, so the image needs
# no separate install. The static assets are not part of it.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# The pre-deploy migration: one bundled file, and the SQL it applies. The script
# resolves the folder from its own location, so `dist/` and `drizzle/` must stay
# siblings, exactly as they are here.
COPY --from=build --chown=nextjs:nodejs /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000

# Liveness only: it must not depend on the database (D-142).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
