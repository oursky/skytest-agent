# Skills

This project includes reusable skills for SkyTest workflows and codebase maintenance.

## For SkyTest Users

SkyTest generation/maintenance skill for MCP-capable agents.

| Skill | Command | Description |
|-------|---------|-------------|
| [skytest-generate](./skytest-skills/skytest-generate/SKILL.md) | `/skytest-generate` | Generate and maintain test cases from feature descriptions, screenshots, or user flows via MCP |

### Installation

Copy the skill folder to your local skills directory for your agent client.

```bash
mkdir -p ~/.agents/skills/skytest-skills
cp -r skills/skytest-skills/. ~/.agents/skills/skytest-skills/
```

Common client-specific linking examples:

- Claude Code / Claude Desktop: link to `~/.claude/skills/`
- Codex: link/copy to `~/.codex/skills/`
- Antigravity: use its configured skills directory

---

## For Developers

Skills for contributors working on the SkyTest Agent codebase.

| Skill | Command | Description |
|-------|---------|-------------|
| [commit](./development-skills/commit/SKILL.md) | `/commit` | Plan logical commit units from staged changes, suggest titles, commit after approval |
| [review](./development-skills/review/SKILL.md) | `/review` | Two-pass code review (spec compliance then code quality) |
| [plan](./development-skills/plan/SKILL.md) | `/plan` | Align on intent and create step-by-step implementation plans |
| [debug](./development-skills/debug/SKILL.md) | `/debug` | Structured debugging: reproduce, trace root cause, minimal fix |

### Installation

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
for s in commit review plan debug; do
  cp -r skills/development-skills/$s ~/.agents/skills/$s
  ln -sf ~/.agents/skills/$s ~/.claude/skills/$s
done
```
