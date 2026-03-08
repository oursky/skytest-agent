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
- **Android Support** — Run cross-platform tests on web and Android apps with a single test suite.
- **MCP & Agent SKill** — Use MCP to let AI coding agents generate test cases from your specs.
- **Parallel execution** - Run tests concurrently for faster feedback.
- **Project management** - Organize test cases and configurations by project with a built-in web UI.
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
cp .env.example .env.local
# Edit .env.local with your credentials
make dev
```

Open http://localhost:3000 and sign in. <br>
Enter your OpenRouter API key in settings and start testing!

## Hosted Version

Don't want to self-host? We're building a managed version of SkyTest.

<a href="https://skytest.ai/#waitlist"><img src="https://img.shields.io/badge/Join_the_Waitlist-orange?style=for-the-badge" alt="Join Waitlist"></a>

## Configuration

See `.env.example` for all available options. Required:

- `DATABASE_URL` - PostgreSQL connection string for the application database
- `S3_*` - S3-compatible object storage credentials and bucket settings. Use local MinIO in development and hosted object storage in production.
- `ENCRYPTION_SECRET` - Random 32+ char string for API key encryption
- `NEXT_PUBLIC_AUTHGEAR_*` - Authgear credentials from [portal.authgear.com](https://portal.authgear.com/)

Users provide their own [OpenRouter](https://openrouter.ai/) API keys via the app settings.

## Troubleshooting

- **Browsers not found**: `npm run playwright:install`
- **Database errors**: Verify `DATABASE_URL`, then run `npx prisma db push`
- **Object storage errors**: Verify the `S3_*` variables and confirm the bucket exists in MinIO/S3
- **View database**: `npm run db:studio`
- **Auth redirect issues**: Check Authgear redirect URI matches your domain
- **Android devices (Local macOS Only)**: See [macOS Android Emulator Guide](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md)

## Local Development

For local development, run the same infrastructure shape as hosted:
- PostgreSQL
- S3-compatible object storage via MinIO

Quick start:

```bash
make dev
```

Runtime processes:
- Browser runs are executed automatically by the control plane per test run
- Android runs require `skytest` runner lifecycle commands (source: `npm run skytest -- ...`, Homebrew: `skytest ...`)

CLI runner management from source:

```bash
npm run skytest -- pair runner "<pairing-token>" --control-plane-url "http://127.0.0.1:3000"
npm run skytest -- get runners
npm run skytest -- start runner <local-runner-id>
npm run skytest -- stop runner <local-runner-id>
npm run skytest -- logs runner <local-runner-id> --tail 200
npm run skytest -- unpair runner <local-runner-id>
```

Reset local runner environment during development:

```bash
npm run skytest -- reset --force
```

Homebrew user workflow:

```bash
brew install <tap>/skytest
skytest --help
skytest get runners
brew upgrade <tap>/skytest
```

Homebrew uninstall and cleanup:

```bash
skytest reset --force
brew uninstall skytest
```

Detailed setup:
- [Local Development Guide](./docs/operators/local-dev.md)

## Community & Contributing

Bug reports, feature requests, and pull requests are all welcome.

- **Report a bug** - [Open an issue](https://github.com/oursky/skytest-agent/issues/new)
- **Request a feature** - [Start a discussion](https://github.com/oursky/skytest-agent/discussions)
- **Contribute code** - Fork the repo, create a branch, and open a pull request

## License

[MIT](LICENSE)
