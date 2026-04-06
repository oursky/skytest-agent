# Provider-Agnostic AI Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate SkyTest from OpenRouter-only runtime config to a provider-agnostic OpenAI-compatible contract, while keeping legacy compatibility and unblocking Case Study migration.

**Architecture:** Add team-level provider-agnostic fields, introduce a runtime provider resolver, and cut over runtime/API/UI/type contracts from OpenRouter-specific names to neutral names. Keep fallback reads from legacy OpenRouter fields during transition and remove them only after migration hardening.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Vitest, i18n locale files, macOS runner bridge.

---

## File Structure and Responsibilities

- `apps/web/prisma/schema.prisma`
  - Add provider-agnostic team AI fields and provider enum; keep legacy OpenRouter fields in transition.
- `apps/web/src/lib/runtime/provider-config.ts` (new)
  - Resolve effective provider config from team record with legacy fallback and validation.
- `apps/web/src/lib/runtime/midscene-env.ts`
  - Build Midscene env map from neutral provider config input.
- `apps/web/src/types/test.ts`
  - Replace OpenRouter-specific run config fields with neutral provider fields.
- `apps/web/src/lib/runners/job-details-service.ts`
  - Load team provider config and emit neutral runtime payload.
- `apps/web/src/lib/runtime/local-browser-runner.ts`
  - Use neutral runtime config fields and provider resolver output.
- `apps/web/src/lib/runtime/test-runner.ts`
  - Fail fast on generic provider config missing; consume neutral model config.
- `apps/macos-runner/runner/engine.ts`
  - Consume neutral job details payload fields; keep temporary compatibility mapping.
- `apps/web/src/app/api/teams/[id]/ai-key/route.ts`
  - Evolve route to provider config semantics (same endpoint path).
- `apps/web/src/components/features/team-ai/ui/TeamAiSettings.tsx`
  - Add provider/base URL/model controls and generic validation/errors.
- `apps/web/src/i18n/locales/en.ts`
- `apps/web/src/i18n/locales/zh-hant.ts`
- `apps/web/src/i18n/locales/zh-hans.ts`
  - Replace OpenRouter-specific user strings with provider-agnostic strings.
- Test updates:
  - `apps/web/src/lib/runtime/__tests__/midscene-env.test.ts`
  - `apps/web/src/lib/runtime/__tests__/test-runner.test.ts`
  - `apps/web/src/lib/runtime/__tests__/local-browser-runner.usage.test.ts`
  - `apps/web/src/lib/runners/__tests__/job-details-service.test.ts`
  - `apps/web/src/lib/mcp/__tests__/run-execution.test.ts`
  - `apps/web/src/app/api/test-runs/dispatch/route.test.ts`

---

### Task 1: Add Provider-Agnostic Team Schema Fields

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/src/types/database.ts`

- [ ] **Step 1: Write failing schema snapshot/type expectation update**

```ts
// apps/web/src/types/database.ts
export interface TeamSummary {
  id: string;
  name: string;
  aiProvider?: string | null;
  aiConfigUpdatedAt?: string | null;
}
```

- [ ] **Step 2: Run lint/typecheck to confirm missing fields fail where referenced**

Run: `npm run lint --workspace @skytest/web`  
Expected: FAIL if new fields are referenced before schema/type updates.

- [ ] **Step 3: Add enum + new team fields in Prisma schema**

```prisma
// apps/web/prisma/schema.prisma
enum AiProvider {
  OPENROUTER
  OPENAI
  XAI
  ANTHROPIC_COMPAT
  CUSTOM_COMPAT
  ACP_COMPAT
}

model Team {
  id                     String      @id @default(cuid())
  name                   String
  aiProvider             AiProvider?
  aiApiKeyEncrypted      String?
  aiBaseUrl              String?
  aiModelMain            String?
  aiModelPlanning        String?
  aiModelInsight         String?
  aiConfigUpdatedAt      DateTime?
  openRouterKeyEncrypted String?
  openRouterKeyUpdatedAt DateTime?
  createdAt              DateTime    @default(now())
  updatedAt              DateTime    @updatedAt
  memberships            TeamMembership[]
  projects               Project[]
  runners                Runner[]
  runnerTokens           RunnerToken[]
}
```

- [ ] **Step 4: Generate Prisma migration and client**

Run: `npx prisma migrate dev --schema apps/web/prisma/schema.prisma -n add-provider-agnostic-ai-config`  
Expected: PASS with new migration generated and Prisma client updated.

- [ ] **Step 5: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations apps/web/src/types/database.ts
git commit -m "Add provider-agnostic team AI config schema"
```

---

### Task 2: Introduce Runtime Provider Resolver with Legacy Fallback

**Files:**
- Create: `apps/web/src/lib/runtime/provider-config.ts`
- Test: `apps/web/src/lib/runtime/__tests__/provider-config.test.ts`

- [ ] **Step 1: Write failing unit tests for resolution priority and validation**

```ts
// apps/web/src/lib/runtime/__tests__/provider-config.test.ts
import { describe, expect, it } from 'vitest';
import { resolveTeamProviderConfig } from '@/lib/runtime/provider-config';

describe('resolveTeamProviderConfig', () => {
  it('prefers new ai* fields over legacy openRouter fields', () => {
    const resolved = resolveTeamProviderConfig({
      aiProvider: 'OPENAI',
      aiApiKeyEncrypted: 'enc:new',
      aiBaseUrl: 'https://api.openai.com/v1',
      aiModelMain: 'gpt-4.1-mini',
      aiModelPlanning: 'gpt-4.1-mini',
      aiModelInsight: 'gpt-4.1-mini',
      openRouterKeyEncrypted: 'enc:legacy',
    });
    expect(resolved.source).toBe('provider-config');
    expect(resolved.providerId).toBe('OPENAI');
  });

  it('falls back to legacy OpenRouter fields when ai* fields are missing', () => {
    const resolved = resolveTeamProviderConfig({
      aiProvider: null,
      aiApiKeyEncrypted: null,
      openRouterKeyEncrypted: 'enc:legacy',
    });
    expect(resolved.source).toBe('legacy-openrouter');
    expect(resolved.providerId).toBe('OPENROUTER');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test --workspace @skytest/web -- provider-config.test.ts`  
Expected: FAIL because resolver module does not exist yet.

- [ ] **Step 3: Implement resolver module**

```ts
// apps/web/src/lib/runtime/provider-config.ts
export interface TeamProviderConfigRecord {
  aiProvider?: string | null;
  aiApiKeyEncrypted?: string | null;
  aiBaseUrl?: string | null;
  aiModelMain?: string | null;
  aiModelPlanning?: string | null;
  aiModelInsight?: string | null;
  openRouterKeyEncrypted?: string | null;
}

export interface ResolvedTeamProviderConfig {
  source: 'provider-config' | 'legacy-openrouter';
  providerId: string;
  encryptedApiKey: string;
  baseUrl: string;
  mainModel: string;
  planningModel: string;
  insightModel: string;
}

export function resolveTeamProviderConfig(record: TeamProviderConfigRecord): ResolvedTeamProviderConfig | null {
  if (record.aiApiKeyEncrypted) {
    return {
      source: 'provider-config',
      providerId: record.aiProvider ?? 'CUSTOM_COMPAT',
      encryptedApiKey: record.aiApiKeyEncrypted,
      baseUrl: record.aiBaseUrl ?? 'https://api.openai.com/v1',
      mainModel: record.aiModelMain ?? 'gpt-4.1-mini',
      planningModel: record.aiModelPlanning ?? record.aiModelMain ?? 'gpt-4.1-mini',
      insightModel: record.aiModelInsight ?? record.aiModelMain ?? 'gpt-4.1-mini',
    };
  }

  if (record.openRouterKeyEncrypted) {
    return {
      source: 'legacy-openrouter',
      providerId: 'OPENROUTER',
      encryptedApiKey: record.openRouterKeyEncrypted,
      baseUrl: 'https://openrouter.ai/api/v1',
      mainModel: 'google/gemini-3.1-flash-lite-preview',
      planningModel: 'qwen/qwen3.5-27b',
      insightModel: 'qwen/qwen3.5-27b',
    };
  }

  return null;
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm run test --workspace @skytest/web -- provider-config.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/runtime/provider-config.ts apps/web/src/lib/runtime/__tests__/provider-config.test.ts
git commit -m "Add provider config resolver with legacy fallback"
```

---

### Task 3: Cut Runtime Contracts to Neutral AI Fields

**Files:**
- Modify: `apps/web/src/types/test.ts`
- Modify: `apps/web/src/lib/runners/job-details-service.ts`
- Modify: `apps/web/src/lib/runtime/local-browser-runner.ts`
- Modify: `apps/web/src/lib/runtime/test-runner.ts`
- Modify: `apps/macos-runner/runner/engine.ts`
- Test: `apps/web/src/lib/runners/__tests__/job-details-service.test.ts`
- Test: `apps/web/src/lib/runtime/__tests__/test-runner.test.ts`
- Test: `apps/web/src/lib/runtime/__tests__/local-browser-runner.usage.test.ts`

- [ ] **Step 1: Write failing tests for neutral field names**

```ts
// test-runner.test.ts
it('fails fast when provider config key is missing', async () => {
  const result = await runTest({
    config: { aiApiKey: '' },
    onEvent: vi.fn(),
    runId: 'run-1',
  } as never);

  expect(result.errorCode).toBe('CONFIGURATION_ERROR');
  expect(result.error).toContain('AI provider configuration is required');
});
```

- [ ] **Step 2: Run targeted runtime tests to confirm failures**

Run: `npm run test --workspace @skytest/web -- test-runner.test.ts local-browser-runner.usage.test.ts job-details-service.test.ts`  
Expected: FAIL due to mismatched field names and expectations.

- [ ] **Step 3: Update shared run config type fields**

```ts
// apps/web/src/types/test.ts (inside RunTestOptions.config)
aiApiKey?: string;
aiBaseUrl?: string;
aiModelMain?: string;
aiModelPlanning?: string;
aiModelInsight?: string;
aiProvider?: string;
```

- [ ] **Step 4: Update job details and local runner payload mapping**

```ts
// job-details-service.ts
config: {
  url: snapshot.url ?? run.testCase.url,
  prompt: snapshot.prompt ?? run.testCase.prompt ?? undefined,
  steps: snapshot.steps ?? fallbackSteps,
  browserConfig: snapshot.browserConfig ?? fallbackBrowserConfig,
  aiApiKey: decrypt(resolved.encryptedApiKey),
  aiBaseUrl: resolved.baseUrl,
  aiModelMain: resolved.mainModel,
  aiModelPlanning: resolved.planningModel,
  aiModelInsight: resolved.insightModel,
  aiProvider: resolved.providerId,
  files: run.files,
  resolvedVariables,
  resolvedFiles,
}
```

- [ ] **Step 5: Update runtime execution checks and Midscene config call sites**

```ts
// test-runner.ts
const {
  aiApiKey,
  aiBaseUrl,
  aiModelMain,
  aiModelPlanning,
  aiModelInsight,
} = testConfig;

if (!aiApiKey) {
  return {
    status: TEST_STATUS.FAIL,
    error: 'AI provider configuration is required. Please configure Team AI settings.',
    errorCode: 'CONFIGURATION_ERROR',
    errorCategory: 'CONFIGURATION',
  };
}

const midsceneModelConfig = buildMidsceneModelConfig({
  apiKey: aiApiKey,
  baseUrl: aiBaseUrl,
  modelMain: aiModelMain,
  modelPlanning: aiModelPlanning,
  modelInsight: aiModelInsight,
});
```

- [ ] **Step 6: Update macOS runner payload mapping with compatibility support**

```ts
// apps/macos-runner/runner/engine.ts
config: {
  url: parsed.config.url,
  prompt: parsed.config.prompt,
  steps: parsed.config.steps as TestStep[] | undefined,
  browserConfig: parsed.config.browserConfig as Record<string, BrowserConfig | TargetConfig> | undefined,
  aiApiKey: (parsed.config as { aiApiKey?: string }).aiApiKey ?? parsed.config.openRouterApiKey,
  aiBaseUrl: (parsed.config as { aiBaseUrl?: string }).aiBaseUrl,
  aiModelMain: (parsed.config as { aiModelMain?: string }).aiModelMain,
  aiModelPlanning: (parsed.config as { aiModelPlanning?: string }).aiModelPlanning,
  aiModelInsight: (parsed.config as { aiModelInsight?: string }).aiModelInsight,
  files: parsed.config.files as TestCaseFile[],
  resolvedVariables: parsed.config.resolvedVariables,
  resolvedFiles: parsed.config.resolvedFiles,
}
```

- [ ] **Step 7: Re-run focused tests**

Run: `npm run test --workspace @skytest/web -- test-runner.test.ts local-browser-runner.usage.test.ts job-details-service.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/types/test.ts apps/web/src/lib/runners/job-details-service.ts apps/web/src/lib/runtime/local-browser-runner.ts apps/web/src/lib/runtime/test-runner.ts apps/macos-runner/runner/engine.ts apps/web/src/lib/runners/__tests__/job-details-service.test.ts apps/web/src/lib/runtime/__tests__/test-runner.test.ts apps/web/src/lib/runtime/__tests__/local-browser-runner.usage.test.ts
git commit -m "Switch runtime payload to provider-agnostic AI fields"
```

---

### Task 4: Generalize Midscene Env Builder

**Files:**
- Modify: `apps/web/src/lib/runtime/midscene-env.ts`
- Test: `apps/web/src/lib/runtime/__tests__/midscene-env.test.ts`

- [ ] **Step 1: Write failing tests for object-based config input**

```ts
// midscene-env.test.ts
it('accepts provider config object and applies baseUrl/model overrides', () => {
  const modelConfig = buildMidsceneModelConfig({
    apiKey: 'k',
    baseUrl: 'https://example-compat.ai/v1',
    modelMain: 'model-main',
    modelPlanning: 'model-plan',
    modelInsight: 'model-insight',
  });

  expect(modelConfig.MIDSCENE_MODEL_BASE_URL).toBe('https://example-compat.ai/v1');
  expect(modelConfig.MIDSCENE_MODEL_NAME).toBe('model-main');
  expect(modelConfig.MIDSCENE_PLANNING_MODEL_NAME).toBe('model-plan');
  expect(modelConfig.MIDSCENE_INSIGHT_MODEL_NAME).toBe('model-insight');
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm run test --workspace @skytest/web -- midscene-env.test.ts`  
Expected: FAIL because signature is still string-only.

- [ ] **Step 3: Implement neutral input signature and env mapping**

```ts
// midscene-env.ts
interface MidsceneProviderInput {
  apiKey: string;
  baseUrl?: string;
  modelMain?: string;
  modelPlanning?: string;
  modelInsight?: string;
}

export function buildMidsceneModelConfig(input: MidsceneProviderInput): MidsceneModelConfig {
  if (!input.apiKey) {
    throw new Error('API key is required');
  }

  const config: MidsceneModelConfig = {
    MIDSCENE_MODEL_API_KEY: input.apiKey,
    MIDSCENE_PLANNING_MODEL_API_KEY: input.apiKey,
    MIDSCENE_INSIGHT_MODEL_API_KEY: input.apiKey,
    MIDSCENE_MODEL_BASE_URL: input.baseUrl ?? resolveMidsceneModelValue('MIDSCENE_MODEL_BASE_URL'),
    MIDSCENE_PLANNING_MODEL_BASE_URL: input.baseUrl ?? resolveMidsceneModelValue('MIDSCENE_PLANNING_MODEL_BASE_URL'),
    MIDSCENE_INSIGHT_MODEL_BASE_URL: input.baseUrl ?? resolveMidsceneModelValue('MIDSCENE_INSIGHT_MODEL_BASE_URL'),
    MIDSCENE_MODEL_NAME: input.modelMain ?? resolveMidsceneModelValue('MIDSCENE_MODEL_NAME'),
    MIDSCENE_PLANNING_MODEL_NAME: input.modelPlanning ?? resolveMidsceneModelValue('MIDSCENE_PLANNING_MODEL_NAME'),
    MIDSCENE_INSIGHT_MODEL_NAME: input.modelInsight ?? resolveMidsceneModelValue('MIDSCENE_INSIGHT_MODEL_NAME'),
    MIDSCENE_MODEL_FAMILY: resolveMidsceneModelValue('MIDSCENE_MODEL_FAMILY'),
    MIDSCENE_PLANNING_MODEL_FAMILY: resolveMidsceneModelValue('MIDSCENE_PLANNING_MODEL_FAMILY'),
    MIDSCENE_INSIGHT_MODEL_FAMILY: resolveMidsceneModelValue('MIDSCENE_INSIGHT_MODEL_FAMILY'),
    MIDSCENE_MODEL_TEMPERATURE: resolveMidsceneModelValue('MIDSCENE_MODEL_TEMPERATURE'),
  };

  return config;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace @skytest/web -- midscene-env.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/runtime/midscene-env.ts apps/web/src/lib/runtime/__tests__/midscene-env.test.ts
git commit -m "Generalize midscene env builder for provider config"
```

---

### Task 5: Evolve Team AI API + UI to Provider Config Semantics

**Files:**
- Modify: `apps/web/src/app/api/teams/[id]/ai-key/route.ts`
- Modify: `apps/web/src/components/features/team-ai/ui/TeamAiSettings.tsx`
- Modify: `apps/web/src/i18n/locales/en.ts`
- Modify: `apps/web/src/i18n/locales/zh-hant.ts`
- Modify: `apps/web/src/i18n/locales/zh-hans.ts`

- [ ] **Step 1: Write API route tests for provider-config payload validation**

```ts
// route.test.ts style in teams API tests folder
expect(response.status).toBe(400);
expect(body.error).toBe('Provider is required');

expect(okResponse.status).toBe(200);
expect(okBody.success).toBe(true);
expect(okBody.provider).toBe('OPENAI');
```

- [ ] **Step 2: Run targeted tests to confirm failure before route update**

Run: `npm run test --workspace @skytest/web -- teams`  
Expected: FAIL for new provider payload expectations.

- [ ] **Step 3: Update route payload contract and persistence**

```ts
// route.ts POST body shape
const payload = await request.json() as {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  modelMain?: string;
  modelPlanning?: string;
  modelInsight?: string;
};

if (!payload.provider) {
  return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Provider is required' });
}
if (!payload.apiKey?.trim()) {
  return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'API key is required' });
}

await prisma.team.update({
  where: { id },
  data: {
    aiProvider: payload.provider as never,
    aiApiKeyEncrypted: encrypt(payload.apiKey),
    aiBaseUrl: payload.baseUrl?.trim() || null,
    aiModelMain: payload.modelMain?.trim() || null,
    aiModelPlanning: payload.modelPlanning?.trim() || null,
    aiModelInsight: payload.modelInsight?.trim() || null,
    aiConfigUpdatedAt: new Date(),
  },
});
```

- [ ] **Step 4: Update Team AI UI state + form controls**

```tsx
// TeamAiSettings.tsx
const [provider, setProvider] = useState('OPENAI');
const [baseUrl, setBaseUrl] = useState('');
const [modelMain, setModelMain] = useState('');
const [modelPlanning, setModelPlanning] = useState('');
const [modelInsight, setModelInsight] = useState('');

body: JSON.stringify({ provider, apiKey, baseUrl, modelMain, modelPlanning, modelInsight })
```

- [ ] **Step 5: Update locale keys to provider-agnostic language**

```ts
// en.ts
"team.ai.title": "AI Provider",
"team.ai.description": "Configure the provider used by test runs in this team.",
"team.ai.provider": "Provider",
"team.ai.baseUrl": "Base URL (OpenAI-compatible)",
"team.ai.modelMain": "Main model",
"team.ai.modelPlanning": "Planning model",
"team.ai.modelInsight": "Insight model",
```

- [ ] **Step 6: Run UI/API related tests**

Run: `npm run test --workspace @skytest/web -- api/teams components/features/team-ai`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/teams/[id]/ai-key/route.ts apps/web/src/components/features/team-ai/ui/TeamAiSettings.tsx apps/web/src/i18n/locales/en.ts apps/web/src/i18n/locales/zh-hant.ts apps/web/src/i18n/locales/zh-hans.ts
git commit -m "Update team AI settings to provider config model"
```

---

### Task 6: Update Dispatch/MCP Compatibility and Error Messaging

**Files:**
- Modify: `apps/web/src/lib/mcp/run-execution.ts`
- Modify: `apps/web/src/app/api/test-runs/dispatch/route.ts`
- Test: `apps/web/src/lib/mcp/__tests__/run-execution.test.ts`
- Test: `apps/web/src/app/api/test-runs/dispatch/route.test.ts`

- [ ] **Step 1: Write failing tests for provider-agnostic required config errors**

```ts
expect(result.failure.error).toContain('Please configure this team AI provider');
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm run test --workspace @skytest/web -- run-execution.test.ts dispatch/route.test.ts`  
Expected: FAIL while assertions still look for OpenRouter text/fields.

- [ ] **Step 3: Replace OpenRouter-specific checks with resolver-based checks**

```ts
const resolvedProviderConfig = resolveTeamProviderConfig({
  aiProvider: testCase.project.team.aiProvider,
  aiApiKeyEncrypted: testCase.project.team.aiApiKeyEncrypted,
  aiBaseUrl: testCase.project.team.aiBaseUrl,
  aiModelMain: testCase.project.team.aiModelMain,
  aiModelPlanning: testCase.project.team.aiModelPlanning,
  aiModelInsight: testCase.project.team.aiModelInsight,
  openRouterKeyEncrypted: testCase.project.team.openRouterKeyEncrypted,
});

if (!resolvedProviderConfig) {
  return { ok: false, failure: { error: 'Please configure this team AI provider' } };
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm run test --workspace @skytest/web -- run-execution.test.ts dispatch/route.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mcp/run-execution.ts apps/web/src/app/api/test-runs/dispatch/route.ts apps/web/src/lib/mcp/__tests__/run-execution.test.ts apps/web/src/app/api/test-runs/dispatch/route.test.ts
git commit -m "Generalize dispatch and MCP provider config checks"
```

---

### Task 7: End-to-End Verification and Case Study Migration Handshake

**Files:**
- Modify: `README.md`
- Modify: `docs/maintainers/frontend-runtime-debugging.md`
- Modify: `docs/operators/local-development.md`
- Modify: `.case-studies/case-study-app/e2e-tests` (follow-up repo/worktree)

- [ ] **Step 1: Add/update documentation for provider-agnostic AI setup**

```md
# README excerpt
Configure Team AI Provider in Team Settings.
SkyTest supports OpenAI-compatible endpoints, including OpenRouter, OpenAI-compatible gateways, ACP-compatible endpoints, and custom providers.
```

- [ ] **Step 2: Run repository verification**

Run: `npm run verify`  
Expected: PASS (lint + typecheck + audit checks).

- [ ] **Step 3: Smoke-run key test suites before Case Study migration**

Run: `npm run test --workspace @skytest/web -- test-runner.test.ts midscene-env.test.ts run-execution.test.ts route.test.ts`  
Expected: PASS.

- [ ] **Step 4: Validate Case Study migration prerequisites checklist**

```md
- Team can save provider config with non-OpenRouter base URL
- Test dispatch works without openRouterKeyEncrypted
- Run artifacts still generated and visible
- Error messages no longer OpenRouter-specific
```

- [ ] **Step 5: Create Case Study migration tracking note**

```md
# .case-studies/case-study-app/docs/skytest-migration-checklist.md
- P0 flows migrated
- P1 flows migrated
- Legacy e2e suite parity validated
- rollback instructions captured
```

- [ ] **Step 6: Commit docs and verification changes**

```bash
git add README.md docs/maintainers/frontend-runtime-debugging.md docs/operators/local-development.md
git commit -m "Document provider-agnostic AI setup and migration checks"
```

---

## Spec Coverage Checklist

- Provider-agnostic team model with legacy fallback: **Task 1 + Task 2**
- Unified OpenAI-compatible contract in runtime: **Task 3 + Task 4**
- Team API/UI/i18n migration: **Task 5**
- Dispatch/MCP enforcement updates: **Task 6**
- Verification and Case Study enablement sequencing: **Task 7**

## Placeholder Scan

- No unresolved placeholder markers in tasks.
- Each code-changing step includes concrete code snippets.
- Each verification step includes explicit commands and expected outcomes.

## Type/Contract Consistency Notes

- Neutral runtime fields are consistently named `aiApiKey`, `aiBaseUrl`, `aiModelMain`, `aiModelPlanning`, `aiModelInsight`, `aiProvider`.
- Legacy OpenRouter fields are read only in compatibility paths and not used as new write contract fields.
