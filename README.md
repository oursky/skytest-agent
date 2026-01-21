# SkyTest Agent

*Self-hosted AI browser agent for validating real user flows in web applications.*

SkyTest Agent executes your tests in a real browser from plain-language steps and produces screenshot-based evidence for review. Validate user journeys without brittle selectors - with support for multi-browser sessions, AI actions alongside custom code, and more.

<video src="https://github.com/user-attachments/assets/adcfa63d-279c-4e8f-9d34-d950678a4255"></video>

## Key Features

- **Plain-language tests** — Write test cases in natural language
- **Visual evidence** — Live screenshots and logs for every run
- **Multi-session flows** — Coordinate across browser roles (e.g., "Browser A" + "Browser B")
- **Custom Playwright code** — Mix AI actions with your own scripts
- **Parallel execution** — Run tests concurrently for faster feedback
- **Project management** — Organize and manage test cases by project
- **Bring Your Own Key** — Use your own API key (BYOK)

Example flow:
```
1. Open the app
2. Sign in as a user
3. Add an item to the cart
4. Verify checkout succeeds
```

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
- **Database errors**: `rm -f dev.db && npx prisma db push`
- **View database**: `npx prisma studio`
- **Auth redirect issues**: Check Authgear redirect URI matches your domain

## License

MIT
