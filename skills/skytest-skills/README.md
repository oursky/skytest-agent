# SkyTest Skills

SkyTest skills for MCP-capable agents. Two skills cover the full lifecycle: `skytest` creates and manages test cases directly from user instructions (no separate explore/plan phase), and `skytest-fix` diagnoses and repairs failing runs.

| Skill | Command | Description |
|-------|---------|-------------|
| [skytest](./skytest/SKILL.md) | `/skytest` | Create, update, run, and manage test cases via MCP from short prompts or exact step lists — playwright-code-first for deterministic interactions |
| [skytest-fix](./skytest-fix/SKILL.md) | `/skytest-fix` | Diagnose failing runs with a failure taxonomy and stabilize tests, defaulting to playwright-code conversion for flaky interaction steps |

## Design Notes

- **No explore/plan pipeline.** Users describe the flow (even briefly); the skill inherits conventions (login step, target name, viewport, ID format, variables) from existing test cases in the project and only asks what it cannot infer. Element detail comes from connected browser tools or screenshots, captured only for the screens the flow touches.
- **Playwright-first.** Clicks, fills, dropdown/datepicker selection, and login run as `playwright-code` steps when selectors are known; `ai-action` is reserved for visual verification, scrolling, and unknown structure.
- **Coverage mode.** Asking to "cover a section" applies the one-concern-per-test decomposition (nav smoke + list/detail, pagination, sorting, create, edit, delete) without a separate planning session.

## Setup

See the shared installation guide in [../README.md](../README.md).
