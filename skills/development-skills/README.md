# Development Skills

Skills for contributors working on the SkyTest Agent codebase.

Current development practice for this repo:
- optimize for the current control-plane + runner architecture
- prefer direct implementation over temporary compatibility layers
- use an epic integration branch plus short-lived topic branches for major refactors
- keep OpenRouter key ownership and usage reporting at the project/team level
- keep Android execution on macOS runners only; hosted web stays browser-first

| Skill | Command | Description |
|-------|---------|-------------|
| [commit](./commit/SKILL.md) | `/commit` | Plan logical commit units from staged changes, suggest titles, commit after approval |
| [review](./review/SKILL.md) | `/review` | Two-pass code review (spec compliance then code quality) |
| [plan](./plan/SKILL.md) | `/plan` | Align on intent and create step-by-step implementation plans |
| [debug](./debug/SKILL.md) | `/debug` | Structured debugging: reproduce, trace root cause, minimal fix |

## Setup

See the shared installation guide in [../README.md](../README.md).
