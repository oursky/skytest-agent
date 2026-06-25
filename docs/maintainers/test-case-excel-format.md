# Test Case Import/Export Format

Audience: maintainers / coding agents changing import/export behavior.

This document describes the supported zip package and per-case Excel format for
test case import and export.

Related docs:

- [coding-agent-maintenance-guide.md](./coding-agent-maintenance-guide.md)

## Where Import/Export Lives

- Import and Export are available **only** on the project's test cases listing
  tab and login-flows tab. They are batch operations over the selected rows.
- There is no single-case import/export on the builder, run, or run-detail
  pages, and no single-case export API endpoint.

## Packaging (Zip)

Both import and export use a single `.zip`. Export produces this layout (import
reads it back, tolerating the leading export-folder prefix):

```
{project}_test_cases_{YYYYMMDD}/
  all-test-status.csv                         # export-only summary; ignored on import
  test-cases/
    {base}.xlsx                               # one workbook per test case / login flow
    {base}/files/<filename>                   # uploaded attachment content
    {base}/config-files/<filename>            # test-case FILE-variable content
  project-config-files/<filename>             # project FILE-variable content (once)
```

- `{base}` is `{displayId}_{name}` (sanitized); the per-case asset folder shares
  the workbook's base name.
- Export is batch; import accepts one zip containing many `test-cases/*.xlsx`.

## Sheets (per-case workbook)

- `Configurations`
- `Browser Targets`
- `Android Targets`
- `Test Steps`

## Configurations Sheet

Row-based table with sections such as `Basic Info` / `Test Case`,
`Project Variable`, `Test Case Variable`, and `File`.

Basic Info rows include `Test Case Name`, `Test Case ID`, and `Kind` (`TEST` or
`LOGIN_FLOW`, carried in the `Name` column). Variable rows use `Section`, `Type`,
`Name`, `Value`, and `Masked` (`Y` when a `Variable` is masked).

## Browser Targets Sheet

- Columns: `Target`, `Name`, `URL`, `Width`, `Height`, `Login Flow`
- `Target` labels are generated (for example `Browser A`, `Browser B`)
- `Login Flow` stores the **displayId** of the referenced login flow test case,
  so the link survives import into a different project. Import resolves it back to
  a real test case id (see Import Behavior).

## Android Targets Sheet

- Columns: `Target`, `Name`, `Device`, `Runner ID`, `APP ID`, `Clear App Data`,
  `Allow Permissions`, `Device Details (separate by /)`
- `Device` stores the canonical raw selector value (emulator profile name, or
  `serial:<adb-serial>` for connected devices).
- `Device Details (separate by /)` is **export-only / display-only**.

## Test Steps Sheet

- Steps include action text and target mapping.
- Export uses the `Browser` column name for target labels (historical naming),
  even when a step targets Android.
- Import resolves target labels/aliases from the target sheets.

## Import Behavior

Import (`POST /api/projects/[id]/test-cases/batch-import`, single `.zip`) does:

- import test case metadata (name, test case ID, kind)
- import targets (browser + Android), test steps, and supported variables
  (`Masked` flag and browser `Width`/`Height` preserved)
- restore uploaded attachments from `test-cases/{base}/files/` into object storage
- resolve `Login Flow` references by displayId — matched within the imported
  batch first (login flows import before the cases that reference them), then
  against existing project test cases; unresolved references are cleared

Issue classification drives the import review dialog:

- **Errors** (block creation entirely): unreadable workbook, missing test case
  name, ambiguous match against existing cases.
- **Warnings** (recoverable; case can import as a draft): missing test case ID,
  missing browser URL / step action, Android runner/device not paired, login
  flow not found, attachments that fail validation. These reflect values a user
  can set or select at run time.
- **Info**: a row matched an existing test case and import will overwrite it.

Import modes:

- `validate` — report per-file `complete` / `incomplete` / `invalid` plus issues.
- `import-valid` — import only complete cases (no errors, no warnings).
- `import-all-draft` — import every non-error case, saving incomplete ones as
  drafts.

Not yet imported: FILE-type variable content (exported under `config-files/` and
`project-config-files/` for forward compatibility, but restore is not wired up).

## Export Behavior

Export (`POST /api/projects/[id]/test-cases/export`, batch) produces the zip
above:

- per-case `Configurations`, `Browser Targets` (incl. `Login Flow`),
  `Android Targets`, and `Test Steps`
- actual attachment content and FILE-variable content bundled alongside each
  workbook
- works for both test cases and login flows
