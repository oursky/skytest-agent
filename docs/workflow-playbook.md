# Change Workflow Playbook

## Goals
- Keep changes small, reviewable, and reversible.
- Preserve atomic commits for every task.

## Workflow
1. Scope the change and list impacted files.
2. Apply minimal diffs to only those files.
3. Stage only related files per commit.
4. Commit each concern separately.
5. Run the most specific validation available.

## Commit Rules
- One concern per commit.
- Commit message: `Verb + scope` (e.g., "Add ownership checks").
- Avoid mixing refactors with behavior changes.
- Keep commits reversible and focused.

## Validation Guidance
- Run targeted tests before broad suites.
- Skip heavy tests unless requested.
- Note any skipped validation in the final summary.
