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
	scheduler-worker \
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

scheduler-worker: ## Start the scheduler worker loop
	SKYTEST_SCHEDULER=true $(NODE_PM) run --workspace @skytest/web scheduler:worker

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

dev: ## Boot local services, apply committed migrations, and start the web app with maintenance + browser + scheduler workers
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
	SKYTEST_SCHEDULER=true $(NODE_PM) run --workspace @skytest/web scheduler:worker & \
	SCHEDULER_PID=$$!; \
	trap 'kill $$MAINT_PID $$BROWSER_WORKER_PID $$SCHEDULER_PID >/dev/null 2>&1' EXIT INT TERM; \
	$(NODE_PM) run dev -- --hostname $(CONTROL_PLANE_HOST) --port $(CONTROL_PLANE_PORT); \
	EXIT_CODE=$$?; \
	kill $$MAINT_PID >/dev/null 2>&1 || true; \
	kill $$BROWSER_WORKER_PID >/dev/null 2>&1 || true; \
	kill $$SCHEDULER_PID >/dev/null 2>&1 || true; \
	wait $$MAINT_PID 2>/dev/null || true; \
	wait $$BROWSER_WORKER_PID 2>/dev/null || true; \
	wait $$SCHEDULER_PID 2>/dev/null || true; \
	exit $$EXIT_CODE

verify: ## Run lint, TypeScript compile, dependency audit, and secret scan
	$(NODE_PM) run verify
	$(MAKE) scan-secrets

scan-secrets-ensure: ## Install gitleaks matching .gitleaks-version (downloads pinned tarball)
	@set -eu; \
	VERSION="$$(cat .gitleaks-version)"; \
	if command -v gitleaks >/dev/null 2>&1; then \
		INSTALLED="$$(gitleaks version 2>/dev/null | head -n1 | awk '{print $$NF}' | sed 's/^v//')"; \
		if [ "$$INSTALLED" = "$$VERSION" ]; then \
			exit 0; \
		fi; \
		echo "gitleaks $$INSTALLED installed but .gitleaks-version pins $$VERSION." >&2; \
		echo "Uninstall the current gitleaks (e.g. 'brew uninstall gitleaks') and rerun, or download $$VERSION from https://github.com/gitleaks/gitleaks/releases." >&2; \
		exit 1; \
	fi; \
	OS="$$(uname -s | tr '[:upper:]' '[:lower:]')"; \
	case "$$(uname -m)" in \
		x86_64|amd64) ARCH=x64 ;; \
		arm64|aarch64) ARCH=arm64 ;; \
		*) echo "Unsupported arch $$(uname -m) for gitleaks install" >&2; exit 1 ;; \
	esac; \
	ARCHIVE="gitleaks_$${VERSION}_$${OS}_$${ARCH}.tar.gz"; \
	TMPDIR="$$(mktemp -d)"; \
	trap 'rm -rf "$$TMPDIR"' EXIT; \
	echo "Downloading gitleaks $$VERSION ($$OS/$$ARCH)..."; \
	curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v$${VERSION}/$${ARCHIVE}" -o "$$TMPDIR/gitleaks.tar.gz"; \
	curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v$${VERSION}/gitleaks_$${VERSION}_checksums.txt" -o "$$TMPDIR/checksums.txt"; \
	EXPECTED="$$(awk -v f="$$ARCHIVE" '$$2 == f { print $$1 }' "$$TMPDIR/checksums.txt")"; \
	if [ -z "$$EXPECTED" ]; then echo "No checksum for $$ARCHIVE in release" >&2; exit 1; fi; \
	if command -v sha256sum >/dev/null 2>&1; then \
		echo "$$EXPECTED  $$TMPDIR/gitleaks.tar.gz" | sha256sum -c -; \
	else \
		ACTUAL="$$(shasum -a 256 "$$TMPDIR/gitleaks.tar.gz" | awk '{print $$1}')"; \
		if [ "$$ACTUAL" != "$$EXPECTED" ]; then echo "Checksum mismatch for $$ARCHIVE" >&2; exit 1; fi; \
	fi; \
	tar -xzf "$$TMPDIR/gitleaks.tar.gz" -C "$$TMPDIR"; \
	INSTALL_DIR="$${GITLEAKS_INSTALL_DIR:-/usr/local/bin}"; \
	if [ -w "$$INSTALL_DIR" ]; then \
		mv "$$TMPDIR/gitleaks" "$$INSTALL_DIR/gitleaks"; \
	else \
		sudo mv "$$TMPDIR/gitleaks" "$$INSTALL_DIR/gitleaks"; \
	fi; \
	gitleaks version

scan-secrets: scan-secrets-ensure ## Run gitleaks secret scan (matches CI)
	gitleaks detect \
		--source . \
		--config .gitleaks.toml \
		--no-git \
		--redact \
		--exit-code 1
