# Skills

This project includes reusable skills for SkyTest workflows and codebase maintenance.

## For SkyTest Users

SkyTest generation/maintenance skill for MCP-capable agents.

| Skill | Command | Description |
|-------|---------|-------------|
| [skytest-generate](./skytest-skills/skytest-generate/SKILL.md) | `/skytest-generate` | Generate and maintain test cases from feature descriptions, screenshots, or user flows via MCP |

## For Linear Integration

Skills for creating and managing Linear bug reports, and converting them into SkyTest regression tests.

| Skill | Command | Description |
|-------|---------|-------------|
| [linear-bug-report](./linear-skills/linear-bug-report/SKILL.md) | `/linear-bug-report` | Create structured bug reports in Linear from screenshots and brief descriptions |
| [linear-bug-revise](./linear-skills/linear-bug-revise/SKILL.md) | `/linear-bug-revise` | Revise an existing Linear bug report to follow the team's standard format |
| [linear-bug-to-skytest](./linear-skills/linear-bug-to-skytest/SKILL.md) | `/linear-bug-to-skytest` | Convert a Linear bug report into SkyTest regression test cases |

### Installation

Copy the skill folders to your local skills directory for your agent client.

```bash
mkdir -p ~/.agents/skills/skytest-skills
cp -r skills/skytest-skills/. ~/.agents/skills/skytest-skills/

mkdir -p ~/.agents/skills/linear-skills
cp -r skills/linear-skills/. ~/.agents/skills/linear-skills/
```

Common client-specific linking examples:

- Claude Code / Claude Desktop: link to `~/.claude/skills/`
- Codex: link/copy to `~/.codex/skills/`
- Antigravity: use its configured skills directory

---

## For Developers

Skills for contributors working on the SkyTest Agent codebase.

Current development practice for this repo:
- optimize for the current control-plane + runner architecture
- prefer direct implementation over temporary compatibility layers
- use an epic integration branch plus short-lived topic branches for major refactors
- keep OpenRouter key ownership and usage reporting at the project/team level
- keep Android execution on macOS runners only; hosted web stays browser-first

| Skill | Command | Description |
|-------|---------|-------------|
| [commit](./development-skills/commit/SKILL.md) | `/commit` | Plan logical commit units from staged changes, suggest titles, commit after approval |
| [review](./development-skills/review/SKILL.md) | `/review` | Two-pass code review (spec compliance then code quality) |
| [plan](./development-skills/plan/SKILL.md) | `/plan` | Align on intent and create step-by-step implementation plans |
| [debug](./development-skills/debug/SKILL.md) | `/debug` | Structured debugging: reproduce, trace root cause, minimal fix |
| [runner-integration](./development-skills/runner-integration/SKILL.md) | `/runner-integration` | Implement control-plane browser execution, macOS runners, durable claiming, and execution/event boundaries |
| [team-product-flow](./development-skills/team-product-flow/SKILL.md) | `/team-product-flow` | Implement org/project membership, invites, project AI keys, usage UX, and permission-aligned flows |
| [pull-request](./development-skills/pull-request/SKILL.md) | `/pull-request` | Draft and prepare PRs with the repo's epic-branch workflow, validation summary, breaking changes, and rollout notes |

### Installation

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
for s in commit review plan debug runner-integration team-product-flow pull-request; do
  cp -r skills/development-skills/$s ~/.agents/skills/$s
  ln -sf ~/.agents/skills/$s ~/.claude/skills/$s
done
```
