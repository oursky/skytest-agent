# SkyTest Design: Provider-Agnostic AI Configuration (OpenAI-Compatible Contract)

Date: 2026-04-05  
Status: Approved (design)  
Scope: SkyTest runtime/provider config migration and Case Study case-study migration enablement

## 1. Problem Statement

SkyTest runtime execution is tightly coupled to OpenRouter-specific configuration and naming:

- Team schema stores only `openRouterKeyEncrypted` and `openRouterKeyUpdatedAt`.
- Runtime and dispatch paths require `openRouterApiKey` explicitly.
- Team UI and messages are OpenRouter-specific.
- `.case-studies/case-study` migration to SkyTest is blocked by provider flexibility requirements (ACP/custom gateways and broader provider support).

The immediate need is to support multiple providers rapidly (OpenAI, xAI, Anthropic via compatible gateways, ACP/custom endpoints), without adding provider-specific runtime forks.

## 2. Goals and Non-Goals

### Goals

1. Introduce a provider-agnostic AI configuration model at team level.
2. Keep runtime execution on a unified OpenAI-compatible endpoint contract.
3. Preserve backward compatibility with existing OpenRouter-backed teams during migration.
4. Make adding new providers mostly configuration-level work.
5. Unblock migration of `.case-studies/case-study` e2e plan to SkyTest.

### Non-Goals (Phase 1)

1. Anthropic-native protocol support.
2. Per-project AI provider overrides.
3. Advanced provider-specific feature surfaces.
4. Broad runtime refactors unrelated to provider configuration.

## 3. Decision Summary

Chosen approach: **Approach C variant**

- Use a unified internal provider interface.
- Standardize runtime calls on OpenAI-compatible endpoint contract.
- Keep Anthropic support in this phase as OpenAI-compatible gateway usage (not native Anthropic API protocol).

## 4. Architecture

### 4.1 Data Model

Add provider-agnostic fields on `Team` while retaining legacy OpenRouter fields for transition:

- `aiProvider` (enum/string): e.g. `OPENROUTER`, `OPENAI`, `XAI`, `ANTHROPIC_COMPAT`, `CUSTOM_COMPAT`, `ACP_COMPAT`
- `aiApiKeyEncrypted` (nullable string)
- `aiBaseUrl` (nullable string)
- `aiModelMain` (nullable string)
- `aiModelPlanning` (nullable string)
- `aiModelInsight` (nullable string)
- `aiConfigUpdatedAt` (nullable datetime)

Legacy retained during transition:

- `openRouterKeyEncrypted`
- `openRouterKeyUpdatedAt`

### 4.2 Provider Resolution Boundary

Introduce provider resolution module (new file):

- Suggested path: `apps/web/src/lib/runtime/provider-config.ts`
- Responsibility:
  - Resolve effective config from team record.
  - Apply fallback to legacy OpenRouter fields if new fields are absent.
  - Validate required values.
  - Produce normalized runtime payload:
    - `providerId`
    - `apiKey`
    - `baseUrl`
    - `mainModel`
    - `planningModel`
    - `insightModel`

### 4.3 Midscene Environment Mapping

Current Midscene env builder is OpenRouter-default-centric in `apps/web/src/lib/runtime/midscene-env.ts`.

Change:

- Keep the same output shape expected by runtime execution.
- Source values from resolved provider config rather than OpenRouter-only assumptions.
- Preserve env override behavior for operator-level emergency overrides.

### 4.4 Runtime and Job Payload Contract

Replace OpenRouter-specific config fields in run payloads/types:

- From: `openRouterApiKey`
- To neutral fields: `aiApiKey`, `aiBaseUrl`, model fields, optionally `providerId` for telemetry

Touch points:

- `apps/web/src/types/test.ts`
- `apps/web/src/lib/runners/job-details-service.ts`
- `apps/web/src/lib/runtime/local-browser-runner.ts`
- `apps/web/src/lib/runtime/test-runner.ts`
- `apps/macos-runner/runner/engine.ts`
- related protocol contract files/tests if required by runner transport payloads

Compatibility during transition:

- Read old payloads if present and map to neutral structure.
- Write new payload structure from updated services.

## 5. API and UI

### 5.1 Team AI Settings API

Current route: `apps/web/src/app/api/teams/[id]/ai-key/route.ts`

Evolve route semantics from OpenRouter-key-only to provider config management:

- GET returns provider config status and masked key metadata.
- POST/PUT accepts provider config payload (`provider`, `baseUrl`, key, models).
- DELETE clears provider config fields.

Validation:

- Generic key presence checks (no OpenRouter-specific prefix assumptions).
- Base URL validation when required.
- Provider enum validation.

### 5.2 Team AI Settings UI

Current component: `apps/web/src/components/features/team-ai/ui/TeamAiSettings.tsx`

Update to:

- Provider selector.
- Optional base URL input.
- API key input.
- Model fields (main/planning/insight) with sensible defaults per provider profile.
- Existing save/remove interactions preserved.

### 5.3 i18n Updates

Replace OpenRouter-specific wording with provider-agnostic wording in:

- `apps/web/src/i18n/locales/en.ts`
- `apps/web/src/i18n/locales/zh-hant.ts`
- `apps/web/src/i18n/locales/zh-hans.ts`

## 6. Error Handling and Safety

- Replace errors like "OpenRouter API key is required" with "AI provider configuration is required".
- Keep existing error categories/codes where possible to avoid downstream disruption.
- Ensure no raw credentials in logs/events.
- Keep masking behavior for key display and logs.

## 7. Testing Strategy

### 7.1 Unit and Service Tests

Update and extend tests around:

- provider config resolution (new + legacy fallback)
- runtime fast-fail behavior when provider config missing/invalid
- job details payload generation
- dispatch validation behavior
- team AI API route validation and persistence

Likely test suites affected:

- `apps/web/src/lib/runtime/__tests__/test-runner.test.ts`
- `apps/web/src/lib/runtime/__tests__/local-browser-runner.usage.test.ts`
- `apps/web/src/lib/runners/__tests__/job-details-service.test.ts`
- `apps/web/src/lib/mcp/__tests__/run-execution.test.ts`
- `apps/web/src/app/api/test-runs/dispatch/route.test.ts`

### 7.2 Regression Verification

- Run `npm run verify` at minimum before merge.
- Add focused scenario verification for existing OpenRouter-configured team to ensure backward compatibility.

## 8. Migration and Rollout Plan

### Phase 1: Schema + compatibility read path

- Add new fields.
- Keep old fields.
- Resolver prioritizes new fields, falls back to old fields.

### Phase 2: Runtime/API/UI cutover

- Shift runtime payload and checks to neutral provider config.
- Update team settings API/UI and i18n.

### Phase 3: Case Study migration enablement

- Begin replacing `.case-studies/case-study` e2e plan with SkyTest test cases using provider-agnostic config.
- Migrate high-value flows first, then full suite.

### Phase 4: Legacy cleanup

- Remove legacy OpenRouter-only fields and code paths after team migration completion and stabilization.

## 9. Case Study Migration Acceptance Criteria

1. SkyTest can execute migrated Case Study scenarios using non-OpenRouter provider config via OpenAI-compatible endpoints.
2. No OpenRouter-specific requirement in API/UI/runtime validation paths.
3. Artifacts and run evidence behavior remain consistent.
4. Existing OpenRouter-configured teams continue functioning during migration window.

## 10. Risks and Mitigations

1. **Risk:** Breaking existing runs for OpenRouter teams.  
   **Mitigation:** compatibility fallback read path + regression tests.

2. **Risk:** Misconfigured custom endpoints causing runtime failures.  
   **Mitigation:** strict input validation and clearer provider-agnostic errors.

3. **Risk:** Contract drift between web and macOS runner payloads.  
   **Mitigation:** synchronized type/protocol updates and test coverage in both paths.

4. **Risk:** Ambiguity about Anthropic support semantics.  
   **Mitigation:** explicit phase scope: OpenAI-compatible route only; native support deferred.

## 11. File Impact Summary (Expected)

- Schema: `apps/web/prisma/schema.prisma`
- Team AI API: `apps/web/src/app/api/teams/[id]/ai-key/route.ts`
- Team AI UI: `apps/web/src/components/features/team-ai/ui/TeamAiSettings.tsx`
- Runtime config: `apps/web/src/lib/runtime/midscene-env.ts`
- New resolver: `apps/web/src/lib/runtime/provider-config.ts`
- Runtime execution: `apps/web/src/lib/runtime/test-runner.ts`
- Local runner orchestration: `apps/web/src/lib/runtime/local-browser-runner.ts`
- Job details service: `apps/web/src/lib/runners/job-details-service.ts`
- Type contracts: `apps/web/src/types/test.ts`
- macOS runner bridge: `apps/macos-runner/runner/engine.ts`
- i18n locales: `apps/web/src/i18n/locales/en.ts`, `apps/web/src/i18n/locales/zh-hant.ts`, `apps/web/src/i18n/locales/zh-hans.ts`
- Test suites across impacted modules

## 12. Out of Scope Follow-Up Candidates

1. Provider-specific advanced capability flags.
2. Per-project provider override with team default inheritance.
3. Anthropic-native transport support.
4. Admin-level provider templates/presets.

## 13. Decision Log (Default Choices for Implementation)

This section records implementation defaults to remove ambiguity during planning and execution.

1. **Provider identifier shape**  
   Use a Prisma enum for `aiProvider` in phase 1. Start with explicit supported values and extend via migrations.

2. **Default model policy**  
   Provide default `main/planning/insight` models per provider profile, with explicit override fields available in Team AI settings.

3. **Base URL policy**  
   Allow `aiBaseUrl` override for all providers, including predefined providers. Enforce strict HTTPS URL validation (except local-development allowances already established by project policy).

4. **Backward compatibility window**  
   Keep fallback reads from legacy OpenRouter fields until Case Study migration is complete and one additional release cycle has shipped.

5. **API route strategy**  
   Keep `apps/web/src/app/api/teams/[id]/ai-key/route.ts` and evolve payload semantics to provider config. Avoid introducing a second route in phase 1.

6. **Runner protocol migration strategy**  
   Use a compatibility transition: dual field support for legacy and neutral payload shapes first, then remove legacy fields after stabilization.

7. **Credential validation policy**  
   Remove hardcoded global `sk-` validation. Use provider-specific validation when known; otherwise apply generic non-empty credential validation.

8. **Case Study rollout strategy**  
   Use phased migration (P0/high-value flows first), then expand to remaining scenarios after evidence stability checks pass.
