FROM mcr.microsoft.com/playwright:v1.57.0-jammy AS base

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

RUN npm exec --workspace @skytest/web -- prisma generate
RUN npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM base AS runner

WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=pwuser:pwuser /app/node_modules /app/node_modules
COPY --from=builder --chown=pwuser:pwuser /app/apps/web /app/apps/web

USER pwuser

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
