FROM mcr.microsoft.com/playwright:v1.61.0-jammy AS base

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/runner-protocol/package.json packages/runner-protocol/package.json

RUN npm ci --include=dev --workspaces --include-workspace-root

FROM base AS builder

COPY --from=deps /app /app
COPY . .

ARG SKYTEST_VERSION=dev
ENV NEXT_PUBLIC_SKYTEST_VERSION=$SKYTEST_VERSION

RUN npm exec --workspace @skytest/web -- prisma generate
RUN npm run build

# Drop build-only artifacts before the runner stage copies apps/web. `.next/cache` alone is ~1.1 GB
# of incremental-build state that `next start` never reads; Next recreates what it needs at runtime.
# This has to happen here, not in the runner stage — deleting after COPY leaves the bytes in the
# parent layer, so the image and every pull stay the same size.
RUN rm -rf apps/web/.next/cache apps/web/.next/trace apps/web/tsconfig.tsbuildinfo

RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM base AS runner

WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# pg_dump must be at least the server's major version, and jammy only ships client 14, so pull the
# client from the PostgreSQL project's own repository. Used by the maintenance loop's backup job.
RUN install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt jammy-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-client-17 \
    dirmngr \
    gnupg \
    gnupg-l10n \
    gnupg-utils \
    gpg \
    gpg-agent \
    gpg-wks-client \
    gpg-wks-server \
    gpgconf \
    gpgsm \
    gpgv \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=pwuser:pwuser /app/node_modules /app/node_modules
COPY --from=builder --chown=pwuser:pwuser /app/apps/web /app/apps/web
COPY --from=builder --chown=pwuser:pwuser /app/packages/runner-protocol /app/packages/runner-protocol

# Keep mutable runtime state out of the (root-owned) application code directory.
# SkyTest writes its instance-identity lockfile under <SKYTEST_RUNTIME_ROOT>/.skytest,
# so point that at a dedicated directory owned by the unprivileged runtime user.
ENV SKYTEST_RUNTIME_ROOT=/app/runtime
RUN mkdir -p /app/runtime && chown -R pwuser:pwuser /app/runtime

USER pwuser

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
