# Test Case Excel Import/Export Format

Audience: maintainers / coding agents changing import/export behavior.

This document describes the supported Excel format for test case import and export.

Related docs:

- [coding-agent-maintenance-guide.md](./coding-agent-maintenance-guide.md)

## Compatibility Policy

- Export uses dedicated target sheets: `Browser Targets` and `Android Targets`.
- Import supports dedicated target sheets only (`Browser Targets` + `Android Targets`).
- Layouts outside those parser paths are unsupported.

## Sheets

- `Configurations`
- `Browser Targets`
- `Android Targets`
- `Test Steps`

## Configurations Sheet

The `Configurations` sheet is a row-based table with sections such as:

- `Basic Info` / `Test Case`
- `Project Variable`
- `Test Case Variable`
- `File`

Variable rows use these columns:

- `Section`
- `Type`
- `Name`
- `Value`
- `Group` (for `Variable`, `Random String`, `File`)
- `Masked` (`Y` when a `Variable` is masked)

## Browser Targets Sheet

- Columns: `Target`, `Name`, `URL`, `Width`, `Height`
- `Target` labels are generated (for example `Browser A`, `Browser B`)
- `Name` is optional display label
- `Width` and `Height` define per-target browser viewport size

## Android Targets Sheet

- Columns:
  - `Target`
  - `Name`
  - `Device`
  - `APP ID`
  - `Clear App Data`
  - `Allow Permissions`
  - `Device Details (separate by /)`
- `Device` stores the canonical raw selector value:
  - emulator profile name for `emulator-profile`
  - `serial:<adb-serial>` for `connected-device`
- `Device Details (separate by /)` is an **export-only / display-only** field (for example `Pixel_7_API_34 / Emulator profile` or `<serial> / Connected device`). It is not used during import.

## Test Steps Sheet

- Steps include action text and target mapping.
- Export uses the `Browser` column name for target labels (historical naming), even when a step targets Android.
- Import resolves target labels/aliases from `Browser Targets` + `Android Targets` sheets.

## Import Behavior

Import does:

- import test case metadata (name, test case ID)
- import targets (browser + Android, including connected-device selectors)
- import test steps
- import project variables (supported non-file types)
- import test case variables (supported non-file types)
  - `Masked` flag on `Variable` rows
  - `Group` values for groupable variable types
  - browser `Width` / `Height` values

Import does not:

- import file variables
- import attached test files
- import `Secret` variable type rows (unsupported)
- import `Testing Target` rows from `Configurations`

Warnings are produced for:

- invalid/unsupported rows
- `File` rows exported from test case attachments (manual upload is still required)

## Export Behavior

- Export includes `Configurations`, `Browser Targets`, `Android Targets`, and `Test Steps`.
- Android targets are exported with device selector, app ID, and toggles.
- Export writes test case attachment metadata as `Configurations` rows with `Section = File`.
- Import does not upload those file attachments automatically; users must upload files manually after import.
