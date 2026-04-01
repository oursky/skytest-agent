# Skills

This directory is organized into three skill sets:

- [development-skills](./development-skills/README.md): skills for contributors working on this codebase (planning, debugging, reviewing, and commit workflows).
- [linear-skills](./linear-skills/README.md): skills for creating/revising Linear bug reports and converting bug tickets into regression tests.
- [skytest-skills](./skytest-skills/README.md): skills for exploring apps, planning tests, managing tests via MCP, and fixing unstable test flows.

## Installation

Copy the skill folders to your local skills directory for your agent client.

```bash
mkdir -p ~/.agents/skills/skytest-skills
cp -r skills/skytest-skills/. ~/.agents/skills/skytest-skills/

mkdir -p ~/.agents/skills/linear-skills
cp -r skills/linear-skills/. ~/.agents/skills/linear-skills/
```

For development skills:

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
for s in commit review plan debug; do
  cp -r skills/development-skills/$s ~/.agents/skills/$s
  ln -sf ~/.agents/skills/$s ~/.claude/skills/$s
done
```

Common client-specific linking examples:
- Claude Code / Claude Desktop: link to `~/.claude/skills/`
- Codex: link/copy to `~/.codex/skills/`
- Antigravity: use its configured skills directory
