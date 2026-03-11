# Test Case Excel Import/Export Format

Audience: maintainers / coding agents changing import/export behavior.

This document describes the current supported Excel format for test case import/export.

Related docs:

- [`docs/maintainers/coding-agent-maintenance-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/coding-agent-maintenance-guide.md)

## Compatibility Policy

- Current export format uses dedicated target sheets: `Browser Targets` and `Android Targets`.
- Import supports both:
  - current multi-sheet target format (`Browser Targets` + `Android Targets`)
  - target rows embedded in `Configurations` (fallback compatibility path)
- Layouts outside those parser paths are unsupported.

## Sheets (Current Export)

- `Configurations`
- `Browser Targets`
- `Android Targets`
- `Test Steps`

## Configurations Sheet

The `Configurations` sheet is a row-based table with sections such as:

- `Basic Info` / `Test Case`
- `Project Variable`
- `Test Case Variable`
- `Testing Target` (current term for fallback import path)
- `File`

Variable rows use these columns:

- `Section`
- `Type`
- `Name`
- `Value`
- `Group` (for `Variable`, `Random String`, `File`)
- `Masked` (`Y` when a `Variable` is masked)

### Testing Targets (Configurations Fallback Import)

- One row per testing target.
- Browser testing targets:
  - `Type = Browser`
  - `Name` (optional label)
  - `Value` (URL)
- Android testing targets:
  - `Type = Android`
  - `Name` (optional label)
- `Device` / `Emulator` / `AVD`
  - `Value` (App ID)
  - `Clear App Data` (boolean)
  - `Allow All Permissions` (boolean)

Notes:

- `Device` values can be:
  - emulator profile name (for `emulator-profile` targets)
  - `serial:<adb-serial>` (for `connected-device` targets)
- `URL` and `App ID` dedicated columns are not used in this fallback path.
- Testing target values must be read from the shared `Value` column.

## Browser Targets Sheet (Current Export)

- Columns: `Target`, `Name`, `URL`, `Width`, `Height`
- `Target` labels are generated (for example `Browser A`, `Browser B`)
- `Name` is optional display label
- `Width` and `Height` define per-target browser viewport size

## Android Targets Sheet (Current Export)

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
  - `Browser Targets` + `Android Targets` sheets (current format), or
  - `Configurations` testing target rows (fallback path)

## Import Behavior (Current Product Policy)

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

Warnings are produced for:

- invalid/unsupported rows
- `File` rows exported from test case attachments (manual upload required in current product flow)

## Export Behavior

- Export includes `Configurations`, `Browser Targets`, `Android Targets`, and `Test Steps`.
- Android targets are exported with device selector, app ID, and toggles.
- Export writes test case attachment metadata as `Configurations` rows with `Section = File`.
- Current import flow does not upload these file attachments automatically; users must upload files manually after import.
