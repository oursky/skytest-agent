SHELL := /bin/sh

NODE_PM ?= npm
COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.local.yml
CONTROL_PLANE_URL ?= http://127.0.0.1:3000
BROWSER_RUNNER_TOKEN ?=
MACOS_RUNNER_TOKEN ?=
MACOS_RUNNER_PAIRING_TOKEN ?=
MACOS_RUNNER_LABEL ?= Local macOS Runner
KUBECTL ?= kubectl
K8S_NAMESPACE ?= skytest
K8S_APP_NAME ?= skytest-agent
K8S_DEPLOYMENT ?= $(K8S_APP_NAME)
K8S_MANIFEST_DIR ?= deploy/k8s

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
	runner-browser \
	runner-macos \
	bootstrap \
	dev \
	dev-browser \
	dev-macos \
	dev-all \
	verify \
	k8s-apply \
	k8s-delete \
	k8s-restart \
	k8s-rollout

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
	$(NODE_PM) run dev

playwright-install: ## Install Playwright Chromium locally
	$(NODE_PM) run playwright:install

runner-browser: ## Start the hosted browser runner (requires BROWSER_RUNNER_TOKEN)
	@if [ -z "$(BROWSER_RUNNER_TOKEN)" ]; then \
		echo "BROWSER_RUNNER_TOKEN is required for runner-browser"; \
		exit 1; \
	fi
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" \
	RUNNER_TOKEN="$(BROWSER_RUNNER_TOKEN)" \
	$(NODE_PM) run runner:browser

runner-macos: ## Start the macOS runner (uses stored credential, MACOS_RUNNER_TOKEN, or MACOS_RUNNER_PAIRING_TOKEN)
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

dev-browser: ## Boot local services, apply schema, start browser runner, and start the web app
	@set -eu; \
	if [ -z "$(BROWSER_RUNNER_TOKEN)" ]; then \
		echo "BROWSER_RUNNER_TOKEN is required for dev-browser"; \
		exit 1; \
	fi; \
	$(MAKE) services-up; \
	$(MAKE) db-setup; \
	trap 'kill $$runner_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" RUNNER_TOKEN="$(BROWSER_RUNNER_TOKEN)" $(NODE_PM) run runner:browser & \
	runner_pid=$$!; \
	$(NODE_PM) run dev

dev-macos: ## Boot local services, apply schema, start macOS runner, and start the web app
	@set -eu; \
	$(MAKE) services-up; \
	$(MAKE) db-setup; \
	trap 'kill $$runner_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" RUNNER_LABEL="$(MACOS_RUNNER_LABEL)" RUNNER_TOKEN="$(MACOS_RUNNER_TOKEN)" RUNNER_PAIRING_TOKEN="$(MACOS_RUNNER_PAIRING_TOKEN)" $(NODE_PM) run runner:macos & \
	runner_pid=$$!; \
	$(NODE_PM) run dev

dev-all: ## Boot local services, apply schema, start both runners, and start the web app
	@set -eu; \
	if [ -z "$(BROWSER_RUNNER_TOKEN)" ]; then \
		echo "BROWSER_RUNNER_TOKEN is required for dev-all"; \
		exit 1; \
	fi; \
	$(MAKE) services-up; \
	$(MAKE) db-setup; \
	trap 'kill $$browser_pid $$macos_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" RUNNER_TOKEN="$(BROWSER_RUNNER_TOKEN)" $(NODE_PM) run runner:browser & \
	browser_pid=$$!; \
	RUNNER_CONTROL_PLANE_URL="$(CONTROL_PLANE_URL)" RUNNER_LABEL="$(MACOS_RUNNER_LABEL)" RUNNER_TOKEN="$(MACOS_RUNNER_TOKEN)" RUNNER_PAIRING_TOKEN="$(MACOS_RUNNER_PAIRING_TOKEN)" $(NODE_PM) run runner:macos & \
	macos_pid=$$!; \
	$(NODE_PM) run dev

verify: ## Run lint, TypeScript compile, and dependency audit
	$(NODE_PM) run verify

k8s-apply: ## Apply Kubernetes manifests from K8S_MANIFEST_DIR
	$(KUBECTL) -n $(K8S_NAMESPACE) apply -f $(K8S_MANIFEST_DIR)

k8s-delete: ## Delete Kubernetes manifests from K8S_MANIFEST_DIR
	$(KUBECTL) -n $(K8S_NAMESPACE) delete -f $(K8S_MANIFEST_DIR)

k8s-restart: ## Restart the configured Kubernetes deployment
	$(KUBECTL) -n $(K8S_NAMESPACE) rollout restart deployment/$(K8S_DEPLOYMENT)

k8s-rollout: ## Wait for the configured Kubernetes deployment rollout to finish
	$(KUBECTL) -n $(K8S_NAMESPACE) rollout status deployment/$(K8S_DEPLOYMENT)
