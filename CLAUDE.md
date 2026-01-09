# Web AutoTest Agent - AI Coding Guidelines

## Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, TailwindCSS 4
- **Backend**: Next.js API Routes, Prisma (SQLite), Server-Sent Events (SSE)
- **Engine**: Playwright 1.57, Midscene.js (AI Automation)
- **Queuing**: Singleton in-memory queue with SQLite persistence

## Code as Documentation 🚨
- **Minimize Comments**: We prefer self-documenting code. Only use comments for complex "why", not "what".
- **Naming Matters**: Use descriptive variable and function names.
- **Type Definitions**: All types in `src/types/`. Export types from components.

## Core Core Patterns
1.  **Strict Types**: No `any`. Define interfaces for all props and API responses.
2.  **API Routes**: Always wrap in `try-catch` and return `NextResponse.json`.
3.  **Configuration**: **NEVER** hardcode values. Use `src/config/app.ts`.
4.  **Database**: Always `await` Prisma queries. Use `src/lib/prisma.ts` singleton.
5.  **Queue Access**: Use `src/lib/queue.ts` singleton. Never create new queue instances.

## Architecture & Flow
- **Execution**: User -> API -> DB (Queued) -> Queue Singleton -> Playwright/Midscene
- **Real-time**: SSE endpoint (`/api/test-runs/[id]/events`) streams logs to client.
- **Persistence**: Final results saved to DB. Logs buffered in memory during run.

## Commands
- `npm run dev`: Start dev server
- `npx prisma studio`: Open DB GUI
- `npx prisma db push`: Push schema changes
