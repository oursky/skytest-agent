# Test Case Excel Import/Export Format

Audience: maintainers / coding agents changing import/export behavior.

This document describes the current supported Excel format for test case import/export.

Related docs:

- [`docs/maintainers/coding-agent-maintenance-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/coding-agent-maintenance-guide.md)

## Compatibility Policy

- Current export format uses dedicated target sheets: `Browsers` and `Android`.
- Import supports both:
  - current multi-sheet target format (`Browsers` + `Android`)
  - target rows embedded in `Configurations` (fallback compatibility path)
- Legacy layouts outside those parser paths are not guaranteed to work.

## Sheets (Current Export)

- `Configurations`
- `Browsers`
- `Android`
- `Test Steps`

## Configurations Sheet

The `Configurations` sheet is a row-based table with sections such as:

- `Basic Info` / `Test Case`
- `Project Variable`
- `Test Case Variable`
- `Entry Point` (import fallback path; current exports use dedicated target sheets)
- `File`

Variable rows use these columns:

- `Section`
- `Type`
- `Name`
- `Value`
- `Group` (for `Variable`, `Random String`, `File`)
- `Masked` (`Y` when a `Variable` is masked)

### Entry Points (Configurations Fallback Import)

- One row per entry point.
- Browser entry points:
  - `Type = Browser`
  - `Name` (optional label)
  - `Value` (URL)
- Android entry points:
  - `Type = Android`
  - `Name` (optional label)
  - `Device` / `Emulator` / `AVD` (parser accepts aliases)
  - `Value` (App ID)
  - `Clear App Data` (boolean)
  - `Allow All Permissions` (boolean)

Notes:

- `Device` values can be:
  - emulator profile name (for `emulator-profile` targets)
  - `serial:<adb-serial>` (for `connected-device` targets)
- `URL` and `App ID` dedicated columns are not used in this fallback path.
- Entry point values must be read from the shared `Value` column.

## Browsers Sheet (Current Export)

- Columns: `Target`, `Name`, `URL`, `Width`, `Height`
- `Target` labels are generated (for example `Browser A`, `Browser B`)
- `Name` is optional display label
- `Width` and `Height` define per-target browser viewport size

## Android Sheet (Current Export)

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
- Export currently uses the `Browser` column name for target labels (historical naming), even when a step targets Android.
- Import resolves target labels/aliases from either:
  - `Browsers` + `Android` sheets (current format), or
  - `Configurations` entry-point rows (fallback path)

## Import Behavior (Current Product Policy)

Import does:

- import test case metadata (name, test case ID)
- import targets (browser + Android, including connected-device selectors)
- import test steps
- import test case variables (supported non-file types)
  - `Masked` flag on `Variable` rows
  - `Group` values for groupable variable types
  - browser `Width` / `Height` values

Import does not:

- import project variables
- import file variables
- import attached files from export zip bundles (run-page import is Excel-only)
- import legacy `Secret` variable type rows (unsupported)

Warnings may still be produced during parsing for invalid/unsupported rows.

## Export Behavior

- Export includes `Configurations`, `Browsers`, `Android`, and `Test Steps`.
- Android targets are exported with device selector, app ID, and toggles.
- Some export surfaces may support zipped attachments for download, but run-page import is designed for Excel workbook import.
