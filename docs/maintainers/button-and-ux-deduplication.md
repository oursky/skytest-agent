# Button/UI Deduplication Refactor (2026-03-11)

## Context

The UI had repeated button class strings, repeated copy-to-clipboard markup, repeated loading spinner markup, and duplicated team-creation API workflow across multiple pages. This caused repeated one-off fixes (cursor, keyboard behavior, disabled state, a11y labels).

## Decisions

1. Introduced shared UI primitives in `src/components/shared/`:
- `Button.tsx`
- `LoadingSpinner.tsx`
- `CopyIconButton.tsx`
- `CopyableCodeBlock.tsx`

2. Migrated high-duplication pages first:
- `src/app/mcp/page.tsx`
- `src/components/features/team-runners/ui/TeamRunners.tsx`
- Team settings components/pages (`TeamAiSettings`, `TeamMembers`, `teams/page.tsx`) for repeated action buttons/spinners.

3. Extracted duplicated team-creation workflow into:
- `src/hooks/useCreateTeam.ts`
- Reused by `Header`, `Projects`, and `Welcome`.

4. Removed dead i18n keys that are no longer referenced:
- `project.settings.save`
- `project.settings.saved`

## Intentional Breaks / Non-Compatibility

- Shared primitives now define default interaction behavior (`cursor-pointer`, `disabled:cursor-not-allowed`, focus ring, transition). New UI should prefer these primitives over ad-hoc class strings.
- Legacy duplicated markup patterns are being replaced rather than preserved.

## Follow-up Work

1. Continue migrating remaining raw `<button>` heavy files (notably `projects/[id]/page.tsx`, `run/page.tsx`, `test-form` subcomponents).
2. Add lint guardrails to prevent new ad-hoc button style duplication.
3. Expand shared primitives only when a real repeated pattern appears; avoid over-generalizing.
