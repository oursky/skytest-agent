---
name: team-product-flow
description: Guide for implementing organization, project membership, invites, project-owned OpenRouter key management, and project-level usage UX. Use when changing org/team flows, permissions, settings pages, invites, AI key ownership, or usage reporting.
---

# Team Product Flow

Use this skill when the task changes how users relate to organizations, projects, invites, AI keys, or usage.

## Trigger Conditions

Use this skill when touching:
- organization routes or membership tables
- project membership or invite routes
- project settings UI
- header org switcher
- project AI key pages or APIs
- usage pages or APIs
- MCP or API permissions that depend on org/project ownership

## Source Of Truth

Read:
- `docs/plans/2026-03-06-control-plane-macos-runner-design.md`
- `docs/plans/2026-03-06-control-plane-macos-runner-plan.md`

## Product Model

Keep the model simple:
- a user belongs to one or more organizations
- an organization contains many projects
- each project is the team workspace

Role model this month:
- org roles: `owner`, `admin`, `member`
- project roles: `admin`, `member`

Do not add subteams or viewers unless explicitly requested.

## Ownership Rules

### OpenRouter key

- owned by project, not user
- used by all runs in the project
- editable only by project admins

### Usage

- recorded at project level
- attributed to actor user
- viewable in project context

### Invites

- project invite may also grant org membership if needed
- invite acceptance must be explicit and auditable

## UI Rules

### First login

If the user has no org memberships:
- route to org bootstrap flow
- do not drop them into an empty personal dashboard

### Header

- org switcher belongs in the main header
- current org context should drive project list and settings

### Project page

Project is the team workspace.

The page should expose tabs or sections for:
- test cases
- members
- AI
- usage
- runners

### Invite flow

Project admins can:
- invite by email
- select project role
- copy invite link
- resend or cancel pending invites

Acceptance page should show:
- org name
- project name
- invited role
- accept / decline

### AI key flow

Project admins:
- set key
- replace key
- remove key

Project members:
- may see configured state
- may not edit key

### Usage flow

Show:
- summary metrics
- filters
- per-run table
- attribution by member

Do not build a full billing system this month.

## Workflow

### 1. Start with permission matrix

Before coding, state:
- which org roles can do the action
- which project roles can do the action
- what non-members should see

### 2. Keep UI and API aligned

If UI hides an action:
- API must still reject it server-side

If API allows an action:
- UI should make the action discoverable for authorized users

### 3. Keep copy and flows explicit

Prefer clear labels like:
- `Shared OpenRouter key`
- `Invite members`
- `Project usage`
- `Android execution requires a macOS runner`

### 4. Avoid user-owned fallbacks

Do not add new flows that imply:
- personal project ownership outside org context
- user-owned AI key as the main path
- user-only usage as the source of truth

## Completion Checklist

- permission matrix is enforced server-side
- user flow still makes sense from first login through invite acceptance
- project AI key actions are project-admin-only
- project usage is team-scoped and user-attributed
- relevant i18n keys are added
- `npm run lint` passes
