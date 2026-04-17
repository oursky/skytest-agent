SHELL := /bin/sh

NODE_PM ?= npm
COMPOSE ?= docker compose
COMPOSE_FILE ?= infra/docker/docker-compose.local.yml
COMPOSE_EXTRA_FILE ?=
CONTROL_PLANE_PORT ?= 3000
CONTROL_PLANE_HOST ?= 127.0.0.1
CONTROL_PLANE_URL ?= http://$(CONTROL_PLANE_HOST):$(CONTROL_PLANE_PORT)
COMPOSE_ARGS := -f $(COMPOSE_FILE) $(if $(COMPOSE_EXTRA_FILE),-f $(COMPOSE_EXTRA_FILE),)

.PHONY: \
	help \
	install \
	services-up \
	services-down \
	services-logs \
	db-generate \
	db-migrate-deploy \
	db-migrate-test \
	db-push \
	db-setup \
	app \
	maintenance \
	browser-worker \
	playwright-install \
	playwright-ensure \
	runner-reset \
	seed-local-defaults \
	bootstrap \
	dev \
	verify \
	scan-secrets \
	scan-secrets-ensure

help: ## Show available targets
	@awk 'BEGIN {FS = ": ## "}; /^[A-Za-z0-9_.-]+: ## / {printf "%-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	$(NODE_PM) install

services-up: ## Start local Postgres and MinIO services
	@set -a; \
	[ -f .env.local ] && . ./.env.local; \
	set +a; \
	$(COMPOSE) $(COMPOSE_ARGS) up -d

services-down: ## Stop local Postgres and MinIO services
	@set -a; \
	[ -f .env.local ] && . ./.env.local; \
	set +a; \
	$(COMPOSE) $(COMPOSE_ARGS) down --remove-orphans

services-logs: ## Tail local Postgres and MinIO service logs
	@set -a; \
	[ -f .env.local ] && . ./.env.local; \
	set +a; \
	$(COMPOSE) $(COMPOSE_ARGS) logs -f postgres minio create-minio-bucket

db-generate: ## Generate Prisma client
	$(NODE_PM) run db:generate

db-migrate-deploy: ## Apply committed Prisma migrations
	$(NODE_PM) run db:migrate:deploy

db-migrate-test: ## Replay migrations from first migration and simulate rollback
	$(NODE_PM) run db:migrate:test

db-push: ## Apply Prisma schema to the configured database
	$(NODE_PM) run db:push

db-setup: db-generate db-migrate-deploy ## Generate Prisma client and apply committed migrations

app: ## Start the local Next.js control plane
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT)

maintenance: ## Start the runner maintenance worker loop
	RUNNER_MAINTENANCE_ONCE=false $(NODE_PM) run runner:maintenance

browser-worker: ## Start the browser run dispatch worker loop
	SKYTEST_BROWSER_WORKER=true $(NODE_PM) run --workspace @skytest/web browser:worker

playwright-install: ## Install Playwright Chromium locally
	$(NODE_PM) run playwright:install

playwright-ensure: ## Install Playwright Chromium when it is missing locally
	@node -e "const fs=require('node:fs'); const { chromium }=require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)" \
		|| $(NODE_PM) run playwright:install

runner-reset: ## Stop all local runner processes and remove local runner state
	$(NODE_PM) run skytest -- reset --force

seed-local-defaults: ## Seed local default Authgear user + owner team/project for local bootstrap
	@set -a; \
	[ -f .env.local ] && . ./.env.local; \
	set +a; \
	node infra/scripts/seed-local-defaults.mjs

bootstrap: ## Install deps, start local services, and apply committed migrations
	$(MAKE) install
	$(MAKE) playwright-ensure
	$(MAKE) scan-secrets-ensure
	$(MAKE) services-up
	$(MAKE) db-setup
	$(MAKE) seed-local-defaults

dev: ## Boot local services, apply committed migrations, and start the web app with maintenance + browser worker
	$(MAKE) services-up
	$(MAKE) db-setup
	$(MAKE) playwright-ensure
	@set -a; \
	[ -f .env.local ] && . ./.env.local; \
	set +a; \
	RUNNER_MAINTENANCE_ONCE=false $(NODE_PM) run runner:maintenance & \
	MAINT_PID=$$!; \
	SKYTEST_BROWSER_WORKER=true $(NODE_PM) run --workspace @skytest/web browser:worker & \
	BROWSER_WORKER_PID=$$!; \
	trap 'kill $$MAINT_PID $$BROWSER_WORKER_PID >/dev/null 2>&1' EXIT INT TERM; \
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT); \
	EXIT_CODE=$$?; \
	kill $$MAINT_PID >/dev/null 2>&1 || true; \
	kill $$BROWSER_WORKER_PID >/dev/null 2>&1 || true; \
	wait $$MAINT_PID 2>/dev/null || true; \
	wait $$BROWSER_WORKER_PID 2>/dev/null || true; \
	exit $$EXIT_CODE

verify: ## Run lint, TypeScript compile, dependency audit, and secret scan
	$(NODE_PM) run verify
	$(MAKE) scan-secrets

scan-secrets-ensure: ## Install gitleaks matching .gitleaks-version if missing
	@if command -v gitleaks >/dev/null 2>&1; then \
		exit 0; \
	fi; \
	VERSION="$$(cat .gitleaks-version)"; \
	if command -v brew >/dev/null 2>&1; then \
		echo "Installing gitleaks via brew (pinned: $$VERSION; brew may install latest)..."; \
		brew install gitleaks; \
	else \
		echo "gitleaks not installed. Install $$VERSION from https://github.com/gitleaks/gitleaks/releases" >&2; \
		exit 1; \
	fi

scan-secrets: scan-secrets-ensure ## Run gitleaks secret scan (matches CI)
	gitleaks detect \
		--source . \
		--config .gitleaks.toml \
		--no-git \
		--redact \
		--exit-code 1
