---
name: skytest
description: >
  Route to the right SkyTest skill based on the user's situation. Use when the
  user wants to work with SkyTest but hasn't specified which numbered skill
  (explore, plan, tools, fix) to use — or when they just say "skytest" and
  need guidance on where to start.
---

# SkyTest Skill Router

Identify what the user needs and route to the correct SkyTest skill.

## Skills

| Skill | When to use | What it needs |
|-------|-------------|---------------|
| `/skytest-1-explore` | Study a new app section before writing tests | App URL + which section |
| `/skytest-2-plan` | Design test cases from a UI skeleton or app description | UI skeleton or equivalent screenshots + descriptions |
| `/skytest-3-tools` | Create, update, delete, or run test cases via MCP | Confirmed test plan, or direct instructions |
| `/skytest-4-fix` | Diagnose and fix a failing test run | Failed run ID, report, or test case ID |

## Routing Rules

Read the user's message and match to a scenario:

| User says | Route to |
|-----------|----------|
| "I want to test my app" / "create tests for [section]" / "start testing" | `/skytest-1-explore` — then pipeline: explore → plan → tools |
| "Here are screenshots" / "here's the app structure" / has a UI skeleton | `/skytest-2-plan` |
| "Create these test cases" / "here's the plan" / has a confirmed plan | `/skytest-3-tools` |
| "Test X failed" / "fix this" / shares a run report or error | `/skytest-4-fix` |
| "Update test case X" / "change step 3" / "delete test" | `/skytest-3-tools` |
| "Run test" / "stop runs" / "check run status" / "list tests" | `/skytest-3-tools` |
| "Add tests for [new section]" (already has tests for other sections) | `/skytest-1-explore` for the new section |

**If unclear**, ask:

> What would you like to do?
> 1. **Explore** a new app section to start testing it
> 2. **Design** test cases from an existing app description
> 3. **Create or manage** test cases in SkyTest
> 4. **Fix** a failing test case

## After Routing

Once you've identified the right skill, **invoke it directly** — don't ask the user to type the slash command. Pass along any context the user already provided (URLs, screenshots, test case IDs, error messages).

## Tips

- **Connect browser tools** (Chrome DevTools MCP or Playwright MCP) before starting. They improve accuracy at every stage: richer exploration, verified login code, and confirmed fix proposals.
- **Work one section at a time.** A 20-page app in one session produces unfocused results and burns tokens. Pick the highest-priority section first.
- **Follow the pipeline order** for new coverage: explore → plan → create. Skipping straight to creating test cases produces lower-quality tests that fail more often.
