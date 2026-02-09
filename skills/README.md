# Skills

This project includes reusable AI coding skills for Claude Code and compatible agents.

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [commit](./commit/SKILL.md) | `/commit` | Plan logical commit units from staged changes, suggest titles, commit after approval |
| [review](./review/SKILL.md) | `/review` | Two-pass code review (spec compliance then code quality) |
| [plan](./plan/SKILL.md) | `/plan` | Align on intent and create step-by-step implementation plans |
| [debug](./debug/SKILL.md) | `/debug` | Structured debugging: reproduce, trace root cause, minimal fix |

## Installation

Copy each skill into your local skills directory and symlink for Claude Code discovery:

```bash
# From the project root
mkdir -p ~/.agents/skills
cp -r skills/commit  ~/.agents/skills/commit
cp -r skills/review  ~/.agents/skills/review
cp -r skills/plan    ~/.agents/skills/plan
cp -r skills/debug   ~/.agents/skills/debug

# Symlink for Claude Code auto-discovery
mkdir -p ~/.claude/skills
ln -sf ~/.agents/skills/commit  ~/.claude/skills/commit
ln -sf ~/.agents/skills/review  ~/.claude/skills/review
ln -sf ~/.agents/skills/plan    ~/.claude/skills/plan
ln -sf ~/.agents/skills/debug   ~/.claude/skills/debug
```

Or run the one-liner:

```bash
for s in commit review plan debug; do cp -r skills/$s ~/.agents/skills/$s && mkdir -p ~/.claude/skills && ln -sf ~/.agents/skills/$s ~/.claude/skills/$s; done
```

After installation, the skills are available as `/commit`, `/review`, `/plan`, and `/debug` in Claude Code.
