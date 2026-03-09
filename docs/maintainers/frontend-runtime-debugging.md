# Frontend Runtime Debugging Playbook

This playbook standardizes investigation of browser-side runtime failures (for example, Next.js runtime overlays, `[object Event]` errors, and third-party editor initialization failures).

## Goals

- Reproduce quickly with deterministic steps.
- Capture high-signal evidence before code changes.
- Isolate the failing layer (app code, framework, CSP, network, worker/bootstrap).
- Apply the smallest fix and add a regression scaffold.

## 1. Reproduction Contract

Collect this at intake:

- Exact page URL and browser.
- Exact click/type sequence.
- Expected behavior and actual behavior.
- Full error text and stack trace from browser console.
- Whether it reproduces after hard refresh and after dev server restart.

Keep one canonical repro sequence in the issue/PR description.

## 2. Evidence Pack (Required Before Fixing)

Capture and attach:

- Browser console errors (full stack, not only stringified message).
- Network failures from DevTools (status code + failing URL).
- Response headers for the page request (especially CSP).
- Relevant server logs for the same timestamp.

If the error value is an object/event, log structured fields:

- `name`, `message`, `stack`
- `type`, `filename`, `lineno`, `colno`
- rejection `reason` shape

For editor/runtime incidents, prefer reproducing on the dedicated route first:

- `/debug/playwright-editor` (development only)

## 3. Layered Triage Order

Use this order to reduce search space fast:

1. Repro isolation:
   - Reproduce in a minimal route/component first.
2. Bootstrap/load path:
   - Local bundle vs CDN/resource loader.
3. Security headers:
   - `script-src`, `worker-src`, `child-src`, `connect-src`.
4. Runtime workers:
   - Worker script load failures and worker `error` events.
5. State/data integrity:
   - Confirm UI state types and mode-switch serialization.

## 4. Third-Party Editor Checklist (Monaco, similar tools)

For Monaco-specific incidents, check in this order:

1. Loader source is explicit and local where possible.
2. Worker creation is allowed by CSP.
3. Worker diagnostics are enabled only when needed.
4. Fallback behavior exists when editor mount fails.
5. Error logging does not collapse unknown values to `[object Event]`.

## 5. Minimal Fix Rules

- Do not refactor unrelated UI while debugging.
- Patch the narrowest failing boundary first.
- Preserve existing UX and i18n behavior.
- Add regression scaffold in the same PR:
  - unit test for error normalization/formatting, or
  - focused route for deterministic reproduction.

## 6. Verification Matrix

Verify all of the following:

- Original repro no longer fails.
- No new console runtime errors on the affected page.
- Existing lint/type checks pass (`npm run lint`).
- If CSP changed, verify after full dev server restart.

## 7. PR Checklist

- [ ] Canonical repro sequence documented.
- [ ] Evidence pack attached.
- [ ] Root cause mapped to one layer from triage order.
- [ ] Minimal fix only.
- [ ] Regression scaffold added.
- [ ] Verification matrix completed.

## Appendix: Fast Root-Cause Matrix

- `Monaco initialization: error: {}` and runtime `[object Event]`
  - Likely loader/worker/CSP intersection.
- Error appears only after mode switch
  - Likely state conversion or mount-time bootstrap.
- Error disappears after full restart
  - Likely header/proxy/caching mismatch in dev session.
