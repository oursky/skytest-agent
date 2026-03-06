---
name: architecture-migration
description: Guide for implementing the March 2026 platform refactor toward a k8s control plane, durable runners, Postgres/object storage, project-owned AI keys and usage, and macOS-only Android execution. Use when changing architecture seams such as storage, queueing, SSE, runner ownership, auth boundaries, or MCP control-plane behavior.
---

# Architecture Migration

Use this skill when a task touches any of the platform seams that can accidentally pull the codebase back toward the old local-first architecture.

## Trigger Conditions

Use this skill when the work touches one or more of:
- `prisma/schema.prisma`
- `src/lib/core/prisma.ts`
- `src/lib/runtime/`
- `src/lib/runners/` or `src/runners/`
- `src/lib/mcp/` or `src/app/api/mcp/route.ts`
- file storage or upload/download APIs
- auth, org/project permission boundaries
- project-level OpenRouter key and usage ownership
- hosted browser vs macOS Android execution behavior

## Source Of Truth

Read these first when the task is non-trivial:
- `docs/plans/2026-03-06-control-plane-macos-runner-design.md`
- `docs/plans/2026-03-06-control-plane-macos-runner-plan.md`

Do not invent a competing architecture.

## Target State

The correct end state is:
- one Next.js control plane on k8s
- Postgres as the durable database
- S3-compatible object storage for files and artifacts
- browser execution through hosted runners
- Android execution only through macOS runners
- project/team-owned OpenRouter key and usage
- control-plane-only MCP

## Hard Rules

- Prefer hard cutover over backward compatibility
- Do not add new SQLite-specific code
- Do not add new local-disk source-of-truth file handling
- Do not add new in-memory queue ownership or in-memory event fanout
- Do not check Android capability from the API host when runner capability should be used
- Do not add new user-owned OpenRouter key behavior if project-owned behavior is the target

## Workflow

### 1. Classify the change

State which seam is being changed:
- storage
- auth/permissions
- runner lifecycle
- run scheduling
- SSE/events
- MCP
- project/team ownership

### 2. Identify the old path and the replacement path

List:
- old codepath to remove
- new codepath to add
- any temporary adapter allowed
- exact removal step for the adapter

If you cannot name the old path to delete, the task is underspecified.

### 3. Keep responsibility boundaries clean

Use these boundaries:
- control plane:
  - auth
  - CRUD
  - scheduling
  - permissions
  - run state
  - artifact metadata
  - MCP
- runner:
  - claiming
  - execution
  - screenshots/logs upload
  - heartbeat
  - local runtime discovery

### 4. Prefer boring durable mechanisms

Default choices:
- Postgres row-based claiming, not message brokers
- object storage, not local uploads
- HTTPS polling, not a new transport stack
- DB-backed SSE polling, not process-local subscribers

### 5. Delete legacy code quickly

If a temporary adapter is needed to keep the branch moving:
- keep it for days, not weeks
- add a removal task immediately
- delete it before the epic branch merges to `main`

## Completion Checklist

Before calling the task done, verify:
- the new path matches the design docs
- the old path was deleted or has an explicit short-lived removal step
- `npm run lint` passes
- any relevant targeted tests pass
- the change does not reintroduce local-only assumptions
