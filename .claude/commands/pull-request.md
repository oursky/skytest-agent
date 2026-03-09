# Pull Request

Use this skill when the user wants to prepare or create a pull request.

## Trigger Conditions

Use this skill when the user asks to:
- create a PR
- draft a PR
- summarize changes for review
- prepare a PR description
- compare a branch against base
- explain what should go into the PR body

## Workflow

### 1. Inspect branch state

Collect:
- current branch name
- likely base branch
- commit list vs base
- changed files vs base
- whether the worktree is clean

### 2. Classify the PR

Classify the PR by primary area of change. Common categories:
- data/schema
- backend/API
- frontend/UI
- infrastructure/deploy
- documentation
- tests
- mixed (cross-cutting)

### 3. Summarize by reviewer-facing concerns

PR summaries should answer:
- what changed
- why it changed
- what superseded code was replaced or deleted (if any)
- what validations were run
- what risks remain

### 4. Call out breaking changes explicitly

If the PR changes behavior incompatibly, say so directly:
- API contract changed
- database schema changed
- runtime behavior removed or changed
- UI flow removed
- migration or manual step required

Do not hide breaking changes inside a generic summary.

### 5. Include validation and rollout notes

Validation section should include:
- lint/type-check results
- test results
- any manual checks performed
- anything not run and why

Rollout notes should include when relevant:
- migration required
- order of deployment
- environment variable changes
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
- `schema: add user preferences table`
- `api: add rate limiting to public endpoints`
- `ui: redesign settings page layout`
- `infra: migrate CI to GitHub Actions`

If the PR is cross-cutting, use a clear summary title instead of a vague one.

Bad:
- `update stuff`
- `fix things`

Good:
- `Add role-based access control to API and UI`

## PR Body Template

Use this structure:

```markdown
## Summary
- ...

## Changes
- ...

## Validation
- Lint: ...
- Tests: ...
- Manual: ...

## Breaking Changes
- ... (or "None")

## Risks
- ...

## Follow-ups
- ...
```

## Guardrails

- Prefer smaller PRs over giant mixed PRs
- Do not bundle unrelated cleanup unless it is deletion of replaced code
- Do not omit validation status
- Do not omit base branch selection
- Do not present temporary adapters without naming the removal plan

## Completion Checklist

Before calling the PR ready:
- current branch and base branch are identified
- diff has been reviewed
- validation section is complete
- breaking changes are explicit
- remaining follow-ups are listed
