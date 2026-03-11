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

Start Docker, then run:

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

## Advanced Setup

- **Environment Variables**: See `.env.example` for required configs like database and storage. Users provide their own OpenRouter keys in the app settings.
- **Local Development**: Check the [Local Dev Guide](./docs/operators/local-dev.md) for running the CLI runner or resetting state.
- **Android Testing**: See the [macOS Android Emulator Guide](./docs/operators/mac-android-emulator-guide.md) to configure cross-platform testing.
- **Kubernetes**: Reference Helm charts are available in `infra/helm`.

### Quick Troubleshooting

- **Browsers not found**: Run `npm run playwright:install`
- **Database errors**: Verify `DATABASE_URL`, then run `npx prisma db push`
- **Object storage errors**: Verify `S3_*` variables and your bucket in MinIO/S3

## Community & Contributing

Bug reports, feature requests, and pull requests are all welcome.

- **Report a bug** - [Open an issue](https://github.com/oursky/skytest-agent/issues/new)
- **Request a feature** - [Start a discussion](https://github.com/oursky/skytest-agent/discussions)
- **Contribute code** - Fork the repo, create a branch, and open a pull request

## License

[MIT](LICENSE)
