# Web AutoTest Agent

AI-powered web testing application. Write test scenarios in plain English and watch the AI agent execute them automatically.

## Features

- Natural language test descriptions
- Real-time execution with live logs
- Project and test case management
- Test history tracking

## Tech Stack

- [Next.js 16](https://nextjs.org/) - Framework
- [Midscene.js](https://midscenejs.com/) - AI agent
- [Playwright](https://playwright.dev/) - Browser automation
- [Prisma](https://www.prisma.io/) + SQLite - Database
- [Authgear](https://www.authgear.com/) - Authentication

## Quick Start

```bash
# Install
npm install
npx playwright install

# Configure
cp .env.example .env.local
# Edit .env.local with your credentials

# Setup database
npx prisma db push

# Run
npm run dev
```

Open http://localhost:3000 and sign in.

## Configuration

You need:
- **AI API Key**: Get from [OpenRouter](https://openrouter.ai/)
- **Authgear**: Create an app at [Authgear Portal](https://portal.authgear.com/)

Edit `.env.local` with your credentials. See `.env.example` for details.

## Supported Models

Recommended:
- `bytedance-seed/seed-1.6` - Fast and cost-effective
- `google/gemini-2.5-flash` - Reliable and affordable

## Troubleshooting

**Browsers not found**: Run `npx playwright install`

**Database errors**: Run `rm -f dev.db && npx prisma db push`

**Auth issues**: Check Authgear credentials and redirect URI

**View database**: Run `npx prisma studio`

## License

MIT
