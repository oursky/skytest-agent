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

When a non-UI file is used by multiple features, move it to `src/lib/`.

## Current feature map

- `features/test-form`: test case authoring UI and state logic.
- `features/result-viewer`: run result presentation and timeline rendering.
- `features/configurations`: config editing UI and config helper utilities.
- `features/project-configs`: project-level config CRUD UI and hook logic.
- `features/device-status`: Android device status panel and row/state helpers.
- `features/files`: file list/upload UI.

## Placement rules

- Put cross-feature components like `Modal` and `Pagination` in `shared/`.
- Put configuration-domain components in `features/configurations/ui/` or `features/configurations/model/`.
- Put `Header`, `Breadcrumbs`, and shell-specific blocks in `layout/`.
- Do not place new feature files at `src/components` root.
- Keep imports explicit by folder role:
  - Prefer feature barrels: `@/components/features/<feature>`
  - Prefer shared/layout barrels: `@/components/shared`, `@/components/layout`
  - Use deep imports only for feature-internal wiring (`ui/model/hooks` internals)
