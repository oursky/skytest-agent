name: team-product-flow
description: Guide for implementing team-scoped projects, email-based membership management, shared OpenRouter key management, and usage UX. Use when changing team flows, permissions, settings pages, membership rules, AI key ownership, or usage reporting.
---

# Team Product Flow

Use this skill when the task changes how users relate to teams, projects, memberships, AI keys, or usage.

## Trigger Conditions

Use this skill when touching:
- team routes or membership tables
- project settings UI
- header team switcher
- team AI key pages or APIs
- usage pages or APIs
- MCP or API permissions that depend on team/project ownership

## Source Of Truth

Read:
- `docs/maintainers/android-runtime-maintenance.md`
- `docs/maintainers/coding-agent-maintenance-guide.md`

## Product Model

Keep the model simple:
- a user belongs to one or more teams
- a team contains many projects
- each project is the team workspace

Role model this month:
- team roles: `owner`, `admin`, `member`

Do not add subteams or viewers unless explicitly requested.

## Ownership Rules

### OpenRouter key

- owned by team, not user
- used by all runs in the team
- editable only by team owners and admins

### Usage

- recorded at project level
- attributed to actor user
- viewable in team context

### Membership

- add/remove membership happens by email
- if an email exactly matches an Authgear-backed user, the membership links automatically
- if no user exists yet, the row stays email-only and should be shown as pending
- ownership transfer happens only from team settings, not from the member table

## UI Rules

### First login

If the user has no team memberships:
- route to team bootstrap flow
- do not drop them into an empty personal dashboard

### Header

- team switcher belongs in the main header
- current team context should drive project list and settings

### Project page

Project is the team workspace.

The page should expose tabs or sections for:
- test cases
- configs
- android when enabled

### Membership flow

Owners and admins can:
- add a member by email
- remove a member
- change a member between `admin` and `member`

Owners:
- transfer ownership from team settings

### AI key flow

Team owners and admins:
- set key
- replace key
- remove key

Team members:
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
- which team roles can do the action
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
- `Add Member`
- `Project usage`
- `Android execution requires a macOS runner`

### 4. Avoid user-owned fallbacks

Do not add new flows that imply:
- personal project ownership outside team context
- user-owned AI key as the main path
- user-only usage as the source of truth

## Completion Checklist

- permission matrix is enforced server-side
- user flow still makes sense from first login through email-based membership claiming
- team AI key actions are team-owner/admin-only
- project usage is team-scoped and user-attributed
- relevant i18n keys are added
- `npm run lint` passes
