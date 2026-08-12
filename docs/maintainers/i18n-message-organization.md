# I18n Message Organization

SkyTest keeps each locale in matching feature-focused modules under
`apps/web/src/i18n/locales/<locale>/`. The locale `index.ts` files assemble those modules into the
flat `Messages` objects consumed by the application; translation keys and `t(...)` usage remain
unchanged.

## Domains

| Module | Message ownership |
| --- | --- |
| `core.ts` | Shared controls, navigation, authentication, welcome, and pagination |
| `project-catalog.ts` | Project lists and test-case management within a project |
| `project-scheduling.ts` | Saved schedule configuration and status |
| `project-settings.ts` | Project execution settings and usage |
| `slack.ts` | Team and project Slack configuration |
| `teams.ts` | Team settings and membership |
| `team-ai.ts` | Team AI provider configuration |
| `runners.ts` | Team runners, pairing, and runner devices |
| `usage.ts` | Team usage and agent API keys |
| `runs.ts` | Run creation, history, results, and timelines |
| `test-authoring.ts` | Test forms, builders, steps, uploads, and files |
| `test-groups.ts` | Test-group editing, execution, and history |
| `devices.ts` | Device state and target configuration |
| `mcp.ts` | MCP connection UI |

## Adding Messages

1. Add the same key to the matching domain file in `en`, `zh-hans`, and `zh-hant`.
2. If a new domain is needed, create the same filename in all three locale directories and add it
   to every locale `index.ts`.
3. Keep each domain file under 200 lines. Split a growing domain by feature ownership instead of
   raising the limit.
4. Run `npm run --workspace @skytest/web quality:check-config-i18n`.

The guardrail discovers domain files automatically and rejects mismatched domains, missing or extra
keys, duplicate keys, fragments omitted from an index, missing referenced keys, and oversized
fragments. `apps/web/src/i18n/__tests__/load-messages.test.ts` additionally verifies that runtime
assembly produces identical key sets for all locales.
