# SkyTest Agent

A self-hosted AI agent for validating real user flows in web applications.

SkyTest Agent controls a real browser, follows plain-language instructions, and verifies what users actually see on screen. It is designed to complement (not replace) traditional test frameworks.

## What SkyTest Agent Is (and Is Not)

**SkyTest Agent is:**
- A lightweight AI agent for validating end-to-end user flows
- Visual-first (screenshot-based) rather than selector-heavy
- Useful for fast reality checks, exploratory validation, and internal workflows
- Fully self-hosted and open source

**SkyTest Agent is not:**
- A full replacement for Playwright / Cypress / Selenium
- A no-maintenance “AI testing solution”
- Optimized for large, long-running regression suites

If you already use traditional E2E automation, SkyTest Agent fits best **around it**, not instead of it.

## Features

- Plain-language test instructions (no XPath or brittle selectors)
- AI agent controlling a real browser
- Visual validation based on what appears on screen
- Live execution with step-by-step logs
- Parallel execution across multiple browsers
- Optional custom Playwright code steps
- File upload support for test inputs
- Project and test case management
- Import and export of test cases
- Bring Your Own API Key (BYOK)

## How It Works (High Level)

1. Describe a user flow in natural language
2. SkyTest Agent launches a real browser
3. The agent follows the instructions step by step
4. Validation is performed visually using screenshots
5. Results include logs and visual evidence

This approach reduces flakiness caused by minor UI or DOM changes, while keeping results debuggable.

## Tech Stack

- [Next.js 16](https://nextjs.org/) — Web framework
- [Midscene.js](https://midscenejs.com/) — AI browser agent
- [Playwright](https://playwright.dev/) — Browser automation
- [Prisma](https://www.prisma.io/) + SQLite — Database
- [Authgear](https://www.authgear.com/) — Authentication

## Quick Start (Development)

```bash
npm install
npx playwright install
cp .env.example .env.local
# Edit .env.local with your credentials
npx prisma db push
npm run dev
```

Open http://localhost:3000 and sign in.

## Configuration

See `.env.example` for all available options. Required:

- `ENCRYPTION_SECRET` - Random 32+ char string for API key encryption
- `NEXT_PUBLIC_AUTHGEAR_*` - Authgear credentials from [portal.authgear.com](https://portal.authgear.com/)

Users provide their own [OpenRouter](https://openrouter.ai/) API keys via the app settings.

## Troubleshooting

- **Browsers not found**: `npx playwright install`
- **Database errors**: `rm -f prisma/dev.db && npx prisma db push`
- **View database**: `npx prisma studio`
- **Auth redirect issues**: Check Authgear redirect URI matches your domain

## For AI Agents

- `CLAUDE.md` - Guidelines for Claude Code
- `AGENTS.md` - Guidelines for Codex

## License

MIT
