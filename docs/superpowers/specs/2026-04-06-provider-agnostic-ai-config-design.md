# Provider-Agnostic AI Config Design (Backward Compatible)

Date: 2026-04-06
Status: Draft for review

## Context

SkyTest currently stores and validates team AI credentials as OpenRouter-specific (`openRouterKeyEncrypted`) and blocks run dispatch when that key is missing. Runtime model wiring already supports endpoint/model overrides via `SKYTEST_MIDSCENE_*`, but portal/API semantics remain OpenRouter-branded.

Recent local setup work added SkyTest-local Authgear and file-source Case Study test-case sync. The next step is to support OpenAI-compatible/OpenCode Copilot endpoints while preserving existing OpenRouter behavior.

## User-Confirmed Decisions

1. Migration strategy: backward-compatible incremental rollout.
2. Default provider preset for new teams: keep OpenRouter default.
3. Key validation: accept any non-empty key (no `sk-` prefix enforcement).
4. `openRouterKeyEncrypted` is production-critical and must never be removed, renamed, or dropped in this change series.

## Goals

1. Make team AI configuration provider-agnostic in API/UI/runtime behavior.
2. Keep existing teams and data working without mandatory migration.
3. Support OpenAI-compatible/OpenCode Copilot endpoint/model configuration from portal settings.
4. Verify Case Study file-source workflow still works and portal can fully run tests end-to-end.

## Non-Goals

1. Remove legacy `openRouterKeyEncrypted` in this pass.
2. Redesign queue/runner architecture.
3. Introduce provider-specific key format validation.

## Hard Safety Constraint

This work must be non-destructive for production data:

1. Do not remove, rename, or repurpose `Team.openRouterKeyEncrypted`.
2. Do not run any migration that drops or rewrites existing key data.
3. Keep legacy read/write behavior functional even after provider-agnostic fields are introduced.
4. Any new fields must be additive and nullable-safe.

## Design Overview

### 1) Data Model (Backward Compatible)

Keep `Team.openRouterKeyEncrypted` as the credential storage field in this phase. Add new provider-agnostic configuration fields on `Team`:

- `aiProvider` (enum-like string, default `openrouter`)
- `aiBaseUrl` (nullable string)
- `aiMainModel` (nullable string)
- `aiPlanningModel` (nullable string)
- `aiInsightModel` (nullable string)
- `aiTemperature` (nullable float)
- `aiConfigUpdatedAt` (nullable DateTime)

Behavioral compatibility:

- If these new fields are unset, runtime falls back to existing defaults.
- Existing teams with only `openRouterKeyEncrypted` continue to run unchanged.

### 2) API Contract Evolution

Evolve existing team AI key routes to include provider config in the same payload:

- `GET /api/teams/:id/ai-key`
  - returns `{ hasKey, maskedKey, updatedAt, providerConfig }`
- `POST /api/teams/:id/ai-key`
  - accepts `{ apiKey, providerConfig }`
  - validates only that `apiKey` is non-empty
  - stores encrypted key and provider config atomically
- `DELETE /api/teams/:id/ai-key`
  - clears key (and optionally provider config reset policy, see implementation note)

Dispatch/API error wording should be provider-agnostic (not OpenRouter-only), while behavior (fail-fast on missing key) remains.

### 3) Runtime Resolution Rules

Runtime Midscene model config resolution order:

1. Team provider config from database (if set)
2. Existing environment overrides (`SKYTEST_MIDSCENE_*`)
3. Built-in defaults

Provider presets:

- `openrouter` preset: current defaults
- `openai-compatible` preset: allows OpenAI/OpenCode-compatible base URL + model names

The provider preset controls default values and UX labels, but runtime ultimately uses resolved base URL/model fields passed to `buildMidsceneModelConfig`.

### 4) UI Behavior (Team AI Settings)

Update Team AI settings screen to include:

- Provider preset selector (default OpenRouter)
- API key input (masked on read)
- Base URL
- Main model
- Planning model
- Insight model
- Temperature

Validation:

- API key: required non-empty when saving key
- No `sk-` prefix requirement
- URL/model fields optional; provider defaults apply when empty

### 5) Backward Compatibility and Migration

Migration should add nullable columns with safe defaults and avoid data rewrite.

Compatibility guarantees:

- Existing OpenRouter-configured teams keep working with no user action.
- Existing local seed/bootstrap flow remains valid.
- No change required for stored encrypted key format.

### 6) Verification Plan

#### A. Unit/API verification

1. Team AI route accepts non-`sk-` keys.
2. Provider config round-trip via GET/POST.
3. Dispatch uses provider-agnostic missing-key message.
4. Legacy-only teams (key present, provider fields unset) still dispatch.

#### B. Case Study file-source reinit verification

Run sync pinned to local seeded Case Study project ID:

`CASE_STUDY_PROJECT_ID=cmnn6ebpr0005mr13h3zzzax9 make -C .case-studies/case-study-app/.skytest sync-case-catalog`

Verify portal still shows expected Case Study cases from file source and source-backed edits still round-trip.

#### C. Portal end-to-end run verification

1. Configure team AI settings with OpenAI-compatible/OpenCode preset.
2. Open `/run` and execute at least one Case Study case.
3. Verify:
   - dispatch succeeds
   - run executes to terminal status
   - events/artifacts visible
   - no auth redirect loop regression

#### D. Regression safety checks

1. Run targeted tests for touched routes/runtime modules.
2. Run `npm run verify`.
3. Re-check authgear proxy behavior for OIDC/userinfo calls.

## Implementation Notes

1. Keep naming and API additions minimal; avoid unrelated refactors.
2. Reuse existing encryption/decryption and permission guards.
3. Preserve current i18n key strategy and update all locales for new UI strings.
4. Ensure no changes break file-backed test-case editing behavior fixed earlier.

## Risks and Mitigations

1. Risk: mixed legacy/new config states cause ambiguous runtime behavior.
   - Mitigation: explicit resolution order and targeted tests for each state.
2. Risk: UI introduces partial saves.
   - Mitigation: single payload save path for key + provider config.
3. Risk: Case Study workflow regressions due unrelated API edits.
   - Mitigation: mandatory post-change sync + portal run checks.
