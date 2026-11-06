# syntax=docker/dockerfile:1
#
# One Dockerfile, three platforms.
#
#   build    compiles Next.js with `output: "standalone"`
#   runner   the image that serves traffic: non-root, PORT from the environment
#
# The same image can also run the pre-deploy migration (`npm run db:migrate`),
# because Render and Railway run that command inside the service image. That is
# why the runner carries production `node_modules` and the `drizzle/` folder as
# well as the standalone server. Without them a pre-deploy step would have no
# drizzle-orm, no pg and no SQL to apply.
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

# Only what the server and the migration script need at run time.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# The standalone server and the static assets it serves.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Pre-deploy migration: SQL, the script, and the modules it imports.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=build --chown=nextjs:nodejs /app/src/server/config ./src/server/config
COPY --from=build --chown=nextjs:nodejs /app/src/server/db ./src/server/db
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000

# Liveness only: it must not depend on the database (D-142).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
