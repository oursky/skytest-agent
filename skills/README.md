# Skills

This project includes reusable AI coding skills for Claude Code and compatible agents.

## For SkyTest Users

Skills for anyone using SkyTest Agent to generate and manage test cases.

| Skill | Command | Description |
|-------|---------|-------------|
| [skytest-generate](./skytest-generate/SKILL.md) | `/skytest-generate` | Generate test cases from feature descriptions with flow understanding |

### Installation

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
cp -r skills/skytest-generate ~/.agents/skills/skytest-generate
ln -sf ~/.agents/skills/skytest-generate ~/.claude/skills/skytest-generate
```

---

## For Developers

Skills for contributors working on the SkyTest Agent codebase.

| Skill | Command | Description |
|-------|---------|-------------|
| [commit](./commit/SKILL.md) | `/commit` | Plan logical commit units from staged changes, suggest titles, commit after approval |
| [review](./review/SKILL.md) | `/review` | Two-pass code review (spec compliance then code quality) |
| [plan](./plan/SKILL.md) | `/plan` | Align on intent and create step-by-step implementation plans |
| [debug](./debug/SKILL.md) | `/debug` | Structured debugging: reproduce, trace root cause, minimal fix |

### Installation

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
for s in commit review plan debug; do
  cp -r skills/$s ~/.agents/skills/$s
  ln -sf ~/.agents/skills/$s ~/.claude/skills/$s
done
```
