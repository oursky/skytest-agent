# SkyTest Agent

AI-powered web testing. Write test scenarios in plain English and watch the AI execute them.

## Features

- Natural language test descriptions
- Real-time execution with live logs
- Multi-browser parallel execution
- Project and test case management
- User-provided API keys (BYOK)

## Tech Stack

- [Next.js 16](https://nextjs.org/) - Framework
- [Midscene.js](https://midscenejs.com/) - AI agent
- [Playwright](https://playwright.dev/) - Browser automation
- [Prisma](https://www.prisma.io/) + SQLite - Database
- [Authgear](https://www.authgear.com/) - Authentication

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

## Configuration

See `.env.example` for all available options. Required:

- `ENCRYPTION_SECRET` - Random 32+ char string for API key encryption
- `NEXT_PUBLIC_AUTHGEAR_*` - Authgear credentials from [portal.authgear.com](https://portal.authgear.com/)

Users provide their own [OpenRouter](https://openrouter.ai/) API keys via the app settings.

## Troubleshooting

- **Browsers not found**: `npx playwright install`
- **Database errors**: `rm -f dev.db && npx prisma db push`
- **View database**: `npx prisma studio`

## License

MIT
