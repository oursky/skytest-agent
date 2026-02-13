<div align="center">

# SkyTest Agent

**The open-source, self-hosted alternative to fragile E2E test suites.**

Write tests in plain language. Get screenshot evidence for every run.

[![GitHub stars](https://img.shields.io/github/stars/oursky/skytest-agent?style=flat)](https://github.com/oursky/skytest-agent/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/oursky/skytest-agent)](https://github.com/oursky/skytest-agent/commits/main)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/oursky/skytest-agent/pulls)

<a href="https://skytest.ai/#waitlist"><img src="https://img.shields.io/badge/Hosted_Version-Join_Waitlist-orange?style=for-the-badge" alt="Join Waitlist"></a>

</div>

## What is SkyTest Agent?

Cypress and Playwright make you code against DOM selectors that break when the UI changes. SkyTest Agent works differently: describe what a user would do in plain language, and a browser agent runs those steps, capturing screenshots as evidence.

It is self-hosted, open source, and uses your own API key.

<video src="https://github.com/user-attachments/assets/c607f068-3a8f-44d9-8642-7cdda7cc80ba"></video>

## Key Features

- **Plain-language tests** - Write test cases the way you'd explain them to a colleague. No CSS selectors or XPaths.
- **Visual evidence** - Every run captures screenshots and logs so you see what happened, not just pass/fail.
- **Multi-session flows** - Coordinate across browser roles (e.g., "Browser A" sends a message, "Browser B" receives it) for multi-user scenarios.
- **Custom Playwright code** - Mix AI-driven steps with your own Playwright scripts when you need precise control.
- **Parallel execution** - Run tests concurrently for faster feedback.
- **Project management** - Organize test cases by project with a built-in web UI.
- **Bring Your Own Key** - Use your own OpenRouter API key. You pay only your LLM costs.

**Example test case:**
```
1. Open the app
2. Sign in as a user
3. Add an item to the cart
4. Verify checkout succeeds
```

[Watch the demo on YouTube](https://www.youtube.com/watch?v=qYlzKr8LWL8)

## Quick Start

```bash
npm install
npx playwright install
cp .env.example .env.local
# Edit .env.local with your credentials
npx prisma db push
npm run dev
```

Open http://localhost:3000 and sign in.

## Hosted Version

Don't want to self-host? We're building a managed version of SkyTest.

<a href="https://skytest.ai/#waitlist"><img src="https://img.shields.io/badge/Join_the_Waitlist-orange?style=for-the-badge" alt="Join Waitlist"></a>

## Configuration

See `.env.example` for all available options. Required:

- `ENCRYPTION_SECRET` - Random 32+ char string for API key encryption
- `NEXT_PUBLIC_AUTHGEAR_*` - Authgear credentials from [portal.authgear.com](https://portal.authgear.com/)

Users provide their own [OpenRouter](https://openrouter.ai/) API keys via the app settings.

Production note:
- By default, test-run submission is blocked in production if the app is using single-node unsafe runtime assumptions (in-memory queue/SSE, SQLite, local uploads).
- To run with that architecture intentionally, set `ALLOW_UNSAFE_SINGLE_NODE_PRODUCTION=true`.

## Troubleshooting

- **Browsers not found**: `npx playwright install`
- **Database errors**: `rm -f dev.db && npx prisma db push`
- **View database**: `npx prisma studio`
- **Auth redirect issues**: Check Authgear redirect URI matches your domain

## Load Test Smoke

Use the built-in smoke harness to estimate run-submission throughput and SSE fanout behavior before public launch:

```bash
npm run load:test:smoke -- \
  --base-url http://localhost:3000 \
  --auth-token "<your access token>" \
  --test-case-id "<test case id>" \
  --requests 20 \
  --concurrency 3
```

Optional flags:
- `--sse true|false` (default `true`)
- `--sse-hold-ms 3000`
- `--url https://example.com`
- `--prompt "Open the page and verify it loads"`

## Auth Ownership Smoke

Run a live owner-vs-attacker authorization check against critical API routes:

```bash
npm run smoke:authz -- \
  --base-url http://localhost:3000 \
  --owner-token "<owner access token>" \
  --attacker-token "<attacker access token>" \
  --project-id "<owner project id>" \
  --test-case-id "<owner test case id>" \
  --test-run-id "<owner test run id>"
```

Optional:
- `--file-id "<owner test case file id>"` to include file-download ownership checks.

## Baseline Verification

Run the core local quality/security baseline in one command:

```bash
npm run verify:baseline
```

## Community & Contributing

Bug reports, feature requests, and pull requests are all welcome.

- **Report a bug** - [Open an issue](https://github.com/oursky/skytest-agent/issues/new)
- **Request a feature** - [Start a discussion](https://github.com/oursky/skytest-agent/discussions)
- **Contribute code** - Fork the repo, create a branch, and open a pull request

## License

[MIT](LICENSE)
