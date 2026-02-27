# Skills

This project includes reusable AI coding skills for Claude Code and compatible agents.

## For SkyTest Users

Skills for anyone using SkyTest Agent to generate and manage test cases.

| Skill | Command | Description |
|-------|---------|-------------|
| [skytest-create-test-case](./skytest-skills/skytest-create-test-case/SKILL.md) | `/skytest-create-test-case` | Confirm end-to-end flows step-by-step, then review and create test cases one-by-one (no batch create) |
| [skytest-create-import-excel](./skytest-skills/skytest-create-import-excel/SKILL.md) | `/skytest-create-import-excel` | Generate import-ready Excel workbooks from confirmed test cases without MCP |

### Installation

```bash
mkdir -p ~/.agents/skills/skytest-skills ~/.claude/skills
cp -r skills/skytest-skills/. ~/.agents/skills/skytest-skills/
find ~/.agents/skills/skytest-skills -type f -name SKILL.md -exec dirname {} \; | while read -r d; do
  ln -sfn "$d" ~/.claude/skills/$(basename "$d")
done
```

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
  cp -r skills/$s ~/.agents/skills/$s
  ln -sf ~/.agents/skills/$s ~/.claude/skills/$s
done
```
