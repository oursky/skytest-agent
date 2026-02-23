# Test Case Excel Import/Export Format

Audience: maintainers / coding agents changing import/export behavior.

This document describes the current supported Excel format for test case import/export.

Related docs:

- [`docs/maintainers/coding-agent-maintenance-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/coding-agent-maintenance-guide.md)

## Compatibility Policy

- Only the current `Configurations` + `Test Steps` workbook format is supported for import.
- Legacy multi-sheet import formats are not supported.
- No backward compatibility is maintained for old Excel layouts.

## Sheets

- `Configurations`
- `Test Steps`

## Configurations Sheet

The `Configurations` sheet is a row-based table with sections such as:

- `Basic Info` / `Test Case`
- `Project Variable`
- `Test Case Variable`
- `Entry Point`
- `File`

### Entry Points

- One row per entry point.
- Browser entry points:
  - `Type = Browser`
  - `Name` (optional label)
  - `Value` (URL)
- Android entry points:
  - `Type = Android`
  - `Name` (optional label)
  - `Emulator`
  - `Value` (App ID)
  - `Clear App Data` (boolean)
  - `Allow All Permissions` (boolean)

Notes:

- `URL` and `App ID` dedicated columns are not used in the current format.
- Entry point values must be read from the shared `Value` column.

## Test Steps Sheet

- Steps include action text and target mapping.
- Target mapping supports both browser and Android entry points from the current `Configurations` sheet.

## Import Behavior (Current Product Policy)

Import does:

- import test case metadata (name, test case ID)
- import entry points (browser + Android)
- import test steps
- import test case variables (supported non-file types)

Import does not:

- import project variables
- import file variables
- import attached files from export zip bundles (run-page import is Excel-only)

Warnings may still be produced during parsing for invalid/unsupported rows.

## Export Behavior

- Export includes the current workbook format.
- Android entry points are exported with emulator name, app ID (in `Value`), and toggles.
- Some export surfaces may support zipped attachments for download, but run-page import is designed for Excel workbook import.
