# Components Structure

## Folder intent

- `features/`: feature-specific components and logic.
- `layout/`: app shell and page-level layout blocks.
- `shared/`: reusable cross-feature components that are not tied to one feature.

## Feature folder contract

Each folder under `features/` owns one feature end-to-end.

- Prefer explicit internal folders:
  - `ui/`: feature UI components (`*.tsx`).
  - `model/`: feature types/helpers/state mapping (`*.ts`).
  - `hooks/`: feature hooks (`use*.ts`).
  - `shared/`: optional, only when a feature truly needs an internal shared layer.

When a non-UI file is used by multiple features, move it to `apps/web/src/lib/`.

## Current feature map

- `features/test-builder`: test case authoring UI and state logic.
- `features/run-results`: run result presentation and timeline rendering.
- `features/test-configurations`: config editing UI and config helper utilities.
- `features/project-configurations`: project-level config CRUD UI and hook logic.
- `features/test-files`: file list/upload UI.
- `features/projects`: project settings and page-level project UI.
- `features/test-cases`: test case list/import/export UI helpers.
- `features/team-ai`: team AI key settings UI.
- `features/team-members`: team membership management UI.
- `features/team-runners`: runner inventory and troubleshooting UI.
- `features/team-usage`: team usage reporting UI.

## Placement rules

- Put cross-feature components like `Modal` and `Pagination` in `shared/`.
- Put configuration-domain components in `features/test-configurations/ui/` or `features/test-configurations/model/`.
- Put `Header`, `Breadcrumbs`, and shell-specific blocks in `layout/`.
- Do not place new feature files at `apps/web/src/components` root.
- Keep imports explicit by folder role:
  - Prefer feature barrels: `@/components/features/<feature>`
  - Prefer shared/layout barrels: `@/components/shared`, `@/components/layout`
  - Use deep imports only for feature-internal wiring (`ui/model/hooks` internals)
