---
name: pull-request
description: Plan and prepare pull requests for this repo's current workflow, including epic-branch development, hard-cutover architecture changes, validation summaries, risks, and cleanup notes. Use when the user asks to draft, summarize, prepare, or create a PR.
---

# Pull Request

Use this skill when the user wants to prepare or create a pull request.

Keep PRs aligned with the current repo practice:
- epic integration branch for major refactors
- short-lived topic branches
- hard cutover over backward compatibility
- explicit documentation of legacy code removal

## Trigger Conditions

Use this skill when the user asks to:
- create a PR
- draft a PR
- summarize changes for review
- prepare a PR description
- compare a branch against base
- explain what should go into the PR body

## Source Of Truth

Read when relevant:
- `docs/plans/2026-03-06-control-plane-macos-runner-design.md`
- `docs/plans/2026-03-06-control-plane-macos-runner-plan.md`

## Default Branch Rules

Choose the base branch using this order:
1. if current branch is a topic branch for the monthly refactor, base it on the active epic branch
2. if current branch is the epic branch, base it on `main`
3. otherwise use the repo's normal target branch or ask if unclear

Do not guess a PR base if branch naming is ambiguous and local git state does not make it obvious.

## Workflow

### 1. Inspect branch state

Collect:
- current branch name
- likely base branch
- commit list vs base
- changed files vs base
- whether the worktree is clean

### 2. Classify the PR

Classify the PR as one of:
- schema
- api
- ui
- runner
- mcp
- deploy
- docs
- mixed platform slice

For this repo, also say whether the PR touches:
- Postgres/object storage
- team membership/ownership
- team AI key or project usage
- runner claiming or leases
- browser runner
- macOS runner
- MCP auth or audit
- k8s deployment

### 3. Summarize by reviewer-facing concerns

PR summaries should answer:
- what changed
- why it changed
- what old path was replaced or deleted
- what validations were run
- what risks remain

### 4. Call out breaking changes explicitly

This repo is currently using hard cutover for platform work.

If the PR changes behavior incompatibly, say so directly:
- API contract changed
- schema changed
- old runtime path removed
- old UI flow removed
- migration required

Do not hide breaking changes inside a generic summary.

### 5. Include validation and rollout notes

Validation section should include:
- `npm run lint`
- `npm run test` if present
- any manual checks performed
- anything not run and why

Rollout notes should include when relevant:
- migration required
- order of deployment
- cleanup branch still pending
- staging checks still needed

### 6. Create or stop

If the user asked to draft/plan:
- output PR title, base branch, and PR body only
- do not create the PR

If the user explicitly asked to create the PR:
- prepare the body first
- create the PR only after confirming required validation is present

## PR Title Rules

Prefer concise imperative titles with area prefix when useful:
- `schema: move project storage to Postgres and object storage`
- `runner: add durable job claiming for browser runners`
- `ui: update team membership and AI settings flows`
- `mcp: scope project keys and audit write actions`

If the PR is a broad platform slice, use a clear summary title instead of a vague one.

Bad:
- `update stuff`
- `fix platform`

Good:
- `runner: move browser execution out of the API process`

## PR Body Template

Use this structure:

```markdown
## Summary
- ...

## Changes
- ...

## Validation
- `npm run lint`
- `npm run test`
- Manual: ...

## Breaking Changes
- ...

## Risks
- ...

## Follow-ups
- ...
```

## Repo-Specific Review Notes

Always mention these when applicable:
- schema migration or data migration impact
- deleted compatibility code
- runner capability changes
- project/team permission changes
- team AI key ownership changes
- MCP scope or audit changes
- deployment or rollout sequencing

## Guardrails

- prefer smaller PRs over giant mixed PRs
- do not bundle unrelated cleanup into the PR unless it is the deletion of the replaced legacy path
- do not omit validation status
- do not omit base branch selection
- do not present temporary adapters without naming the removal plan

## Completion Checklist

Before calling the PR ready:
- current branch and base branch are identified
- diff has been reviewed
- validation section is complete
- breaking changes are explicit
- deleted legacy paths are named
- remaining follow-ups are listed
