SHELL := /bin/sh

NODE_PM ?= npm
COMPOSE ?= docker compose
COMPOSE_FILE ?= infra/docker/docker-compose.local.yml
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
	browser-worker \
	helm-lint \
	helm-template \
	playwright-install \
	runner-reset \
	bootstrap \
	dev \
	verify

help: ## Show available targets
	@awk 'BEGIN {FS = ": ## "}; /^[A-Za-z0-9_.-]+: ## / {printf "%-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	$(NODE_PM) install

services-up: ## Start local Postgres and GCS emulator services
	$(COMPOSE) -f $(COMPOSE_FILE) up -d

services-down: ## Stop local Postgres and GCS emulator services
	$(COMPOSE) -f $(COMPOSE_FILE) down --remove-orphans

services-logs: ## Tail local Postgres and GCS emulator service logs
	$(COMPOSE) -f $(COMPOSE_FILE) logs -f postgres gcs create-gcs-bucket

db-generate: ## Generate Prisma client
	$(NODE_PM) run db:generate

db-push: ## Apply Prisma schema to the configured database
	$(NODE_PM) run db:push

db-setup: db-generate db-push ## Generate Prisma client and apply schema

app: ## Start the local Next.js control plane
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT)

maintenance: ## Start the runner maintenance worker loop
	RUNNER_MAINTENANCE_ONCE=false $(NODE_PM) run runner:maintenance

browser-worker: ## Start the browser run dispatch worker loop
	SKYTEST_BROWSER_WORKER=true $(NODE_PM) run --workspace @skytest/web browser:worker

helm-lint: ## Lint Helm chart for Kubernetes deployment
	helm lint infra/helm

helm-template: ## Render Helm chart templates locally
	helm template skytest infra/helm

playwright-install: ## Install Playwright Chromium locally
	$(NODE_PM) run playwright:install

runner-reset: ## Stop all local runner processes and remove local runner state
	$(NODE_PM) run skytest -- reset --force

bootstrap: ## Install deps, start local services, and apply the database schema
	$(MAKE) install
	$(MAKE) services-up
	$(MAKE) db-setup

dev: ## Boot local services, apply schema, and start the web app with maintenance + browser worker
	$(MAKE) services-up
	$(MAKE) db-setup
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

verify: ## Run lint, TypeScript compile, and dependency audit
	$(NODE_PM) run verify
