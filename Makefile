SHELL := /bin/sh

NODE_PM ?= npm
COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.local.yml
CONTROL_PLANE_PORT ?= 3000
CONTROL_PLANE_HOST ?= 127.0.0.1
CONTROL_PLANE_URL ?= http://$(CONTROL_PLANE_HOST):$(CONTROL_PLANE_PORT)

.PHONY: \
	help \
	install \
	services-up \
	services-down \
	services-logs \
	db-generate \
	db-push \
	db-setup \
	app \
	maintenance \
	playwright-install \
	runner-reset \
	bootstrap \
	dev \
	verify

help: ## Show available targets
	@awk 'BEGIN {FS = ": ## "}; /^[A-Za-z0-9_.-]+: ## / {printf "%-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	$(NODE_PM) install

services-up: ## Start local Postgres and MinIO services
	$(COMPOSE) -f $(COMPOSE_FILE) up -d

services-down: ## Stop local Postgres and MinIO services
	$(COMPOSE) -f $(COMPOSE_FILE) down

services-logs: ## Tail local Postgres and MinIO service logs
	$(COMPOSE) -f $(COMPOSE_FILE) logs -f postgres minio createbuckets

db-generate: ## Generate Prisma client
	$(NODE_PM) run db:generate

db-push: ## Apply Prisma schema to the configured database
	npx prisma db push

db-setup: db-generate db-push ## Generate Prisma client and apply schema

app: ## Start the local Next.js control plane
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT)

maintenance: ## Start the runner maintenance worker loop
	RUNNER_MAINTENANCE_ONCE=false $(NODE_PM) run runner:maintenance

playwright-install: ## Install Playwright Chromium locally
	$(NODE_PM) run playwright:install

runner-reset: ## Stop all local runner processes and remove local CLI runner state
	$(NODE_PM) run skytest -- reset --force

bootstrap: ## Install deps, start local services, and apply the database schema
	$(MAKE) install
	$(MAKE) services-up
	$(MAKE) db-setup

dev: ## Boot local services, apply schema, and start the web app with runner maintenance
	$(MAKE) services-up
	$(MAKE) db-setup
	@RUNNER_MAINTENANCE_ONCE=false $(NODE_PM) run runner:maintenance & \
	MAINT_PID=$$!; \
	trap 'kill $$MAINT_PID >/dev/null 2>&1' EXIT INT TERM; \
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT); \
	EXIT_CODE=$$?; \
	kill $$MAINT_PID >/dev/null 2>&1 || true; \
	wait $$MAINT_PID 2>/dev/null || true; \
	exit $$EXIT_CODE

verify: ## Run lint, TypeScript compile, and dependency audit
	$(NODE_PM) run verify
