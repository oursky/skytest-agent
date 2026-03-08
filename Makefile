SHELL := /bin/sh

NODE_PM ?= npm
COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.local.yml
CONTROL_PLANE_PORT ?= 3000
CONTROL_PLANE_HOST ?= 127.0.0.1
CONTROL_PLANE_URL ?= http://$(CONTROL_PLANE_HOST):$(CONTROL_PLANE_PORT)
ENV_LOCAL ?= .env.local
MACOS_RUNNER_TOKEN ?=
MACOS_RUNNER_PAIRING_TOKEN ?=
MACOS_RUNNER_LABEL ?= Local macOS Runner

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
	playwright-install \
	runner-macos-stop \
	runner-macos \
	bootstrap \
	dev \
	dev-macos \
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

playwright-install: ## Install Playwright Chromium locally
	$(NODE_PM) run playwright:install

runner-macos-stop: ## Stop local macOS runner processes
	@set -eu; \
	lock_pid=$$(node -e "const fs=require('fs');const p=process.env.HOME+'/.skytest-agent/runner.lock';try{const d=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(d.pid||''));}catch{process.stdout.write('');}"); \
	if [ -n "$$lock_pid" ]; then \
		kill -TERM "$$lock_pid" >/dev/null 2>&1 || true; \
		sleep 1; \
		kill -0 "$$lock_pid" >/dev/null 2>&1 && kill -KILL "$$lock_pid" >/dev/null 2>&1 || true; \
	fi; \
	pkill -f "runner/index.ts" >/dev/null 2>&1 || true

runner-macos: ## Start the macOS runner (uses stored credential, MACOS_RUNNER_TOKEN, or MACOS_RUNNER_PAIRING_TOKEN)
	@set -eu; \
	$(MAKE) runner-macos-stop; \
	set -a; [ -f "$(ENV_LOCAL)" ] && . "$(ENV_LOCAL)"; set +a; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" \
	RUNNER_LABEL="$(MACOS_RUNNER_LABEL)" \
	RUNNER_TOKEN="$(MACOS_RUNNER_TOKEN)" \
	RUNNER_PAIRING_TOKEN="$(MACOS_RUNNER_PAIRING_TOKEN)" \
	$(NODE_PM) run runner:macos

bootstrap: ## Install deps, start local services, and apply the database schema
	$(MAKE) install
	$(MAKE) services-up
	$(MAKE) db-setup

dev: ## Boot local services, apply schema, and start the web app
	$(MAKE) services-up
	$(MAKE) db-setup
	$(MAKE) app

dev-macos: ## Boot local services, apply schema, start macOS runner, and start the web app
	@set -eu; \
	$(MAKE) services-up; \
	$(MAKE) db-setup; \
	trap 'if [ -n "$${runner_pid:-}" ]; then kill "$$runner_pid" >/dev/null 2>&1 || true; fi; if [ -n "$${app_pid:-}" ]; then kill "$$app_pid" >/dev/null 2>&1 || true; fi' EXIT INT TERM; \
	set -a; [ -f "$(ENV_LOCAL)" ] && . "$(ENV_LOCAL)"; set +a; \
	if curl -fsS "$(CONTROL_PLANE_URL)/api/health/live" >/dev/null 2>&1; then \
		echo "Control plane already running at $(CONTROL_PLANE_URL); reusing existing process."; \
		app_pid=""; \
	else \
		$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT) & \
		app_pid=$$!; \
		for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
			if curl -fsS "$(CONTROL_PLANE_URL)/api/health/live" >/dev/null 2>&1; then \
				break; \
			fi; \
			sleep 1; \
			if [ "$$i" -eq 15 ]; then \
				echo "Control plane did not become ready at $(CONTROL_PLANE_URL)"; \
				exit 1; \
			fi; \
		done; \
	fi; \
	$(MAKE) runner-macos-stop; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" RUNNER_LABEL="$(MACOS_RUNNER_LABEL)" RUNNER_TOKEN="$(MACOS_RUNNER_TOKEN)" RUNNER_PAIRING_TOKEN="$(MACOS_RUNNER_PAIRING_TOKEN)" $(NODE_PM) run runner:macos & \
	runner_pid=$$!; \
	if [ -n "$${app_pid:-}" ]; then \
		wait $$app_pid; \
	else \
		wait $$runner_pid; \
	fi

verify: ## Run lint, TypeScript compile, and dependency audit
	$(NODE_PM) run verify
