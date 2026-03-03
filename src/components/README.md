# Components Structure

## Folder intent

- `features/`: feature-specific components and logic.
- `layout/`: app shell and page-level layout blocks.
- `ui/`: reusable presentational primitives with no feature ownership.

## Feature folder contract

Each folder under `features/` owns one feature end-to-end.

- `*.tsx`: UI components for that feature.
- `*.ts`: non-UI logic (`types`, `hooks`, helpers, mapping/state utilities).

When a non-UI file is used by multiple features, move it to `src/lib/`.

## Current feature map

- `features/test-form`: test case authoring UI and state logic.
- `features/result-viewer`: run result presentation and timeline rendering.
- `features/configurations`: config editing UI and config helper utilities.
- `features/project-configs`: project-level config CRUD UI and hook logic.
- `features/device-status`: Android device status panel and row/state helpers.
- `features/files`: file list/upload UI.

## Placement rules

- Put `Modal`, `Pagination`, and similar primitives in `ui/`.
- Put `Header`, `Breadcrumbs`, and shell-specific blocks in `layout/`.
- Do not place new feature files at `src/components` root.
- Keep imports explicit by folder role:
  - Feature entry points from `@/components/features/<feature>/...`
  - Shared UI from `@/components/ui/...`
  - Layout from `@/components/layout/...`
