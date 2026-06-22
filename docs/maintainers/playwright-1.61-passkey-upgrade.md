# Playwright ≥ 1.61 upgrade & native passkey support (Phase 5)

**Status:** Pinned, not yet installed/validated. `apps/web/package.json` pins
`playwright` and `@playwright/test` at **1.61.0**, but the lockfile and
`node_modules` must be regenerated and the upgrade validated in a real dev/CI
environment (see "Why this is not finished in-repo" below). This unblocks the
native WebAuthn (passkey) auth path described in the login-flows / run-groups
architecture (§3.4, §3.6, D5).

This document is the runbook for completing the upgrade and wiring passkey /
session-auth support on top of the session engine that already shipped in
Phases 2–4.

## Why 1.61

Playwright 1.61 adds the native virtual WebAuthn authenticator
(`browserContext.credentials`), which lets a login flow complete
`navigator.credentials.create()` / `navigator.credentials.get()` passkey
ceremonies with no real hardware key, cross-browser. The installed 1.57 has no
such API (0 matches for `credentials` / `WebAuthn` / `VirtualAuthenticator` in
`playwright-core/types/types.d.ts`). `storageState`, `addCookies`, and
`httpCredentials` already exist in 1.57 and do **not** require the upgrade.

## Why this is not finished in-repo

The pins were bumped to 1.61.0, but the change could not be completed here:

1. **The sandbox npm cannot materialize `playwright-core@1.61`.** Even after a
   clean reinstall, only `playwright-core@1.57` lands on disk (the registry
   serves the 1.61 tarball, so this is an environment constraint, not a
   dependency conflict).
2. **Version skew → type error.** With our app on 1.61 and `@midscene/web`'s
   subtree resolved to its own `playwright@1.57`, two `playwright-core` type
   trees coexist. `runTest` passes a `Page` created by our `chromium` (1.61) to
   midscene's `PlaywrightAgent` (1.57), which `tsc` rejects:
   `test-runner.ts` `createBrowserTargetContext` — *"Page is not assignable to
   parameter of type Page"* between the two `playwright-core` copies.

`@midscene/web` (both 1.9.2 and latest 1.9.8) declares `playwright` as
`^1.45.0` — a range that already permits 1.61 — so **upgrading midscene does not
gate or fix this.** The fix is to force a single Playwright version across the
whole tree.

## Procedure (run in a real dev/CI environment)

1. Keep the exact pins in `apps/web/package.json`: `playwright` and
   `@playwright/test` at `1.61.0`.
2. Add an override so midscene's subtree resolves to the same version (single
   `playwright-core`, no skew). In the root `package.json` `overrides`:
   ```json
   "playwright": "1.61.0",
   "playwright-core": "1.61.0",
   "@playwright/test": "1.61.0"
   ```
3. `npm install` to regenerate `package-lock.json`, then
   `npm run --workspace @skytest/web playwright:install` to fetch the 1.61
   browser.
4. Re-validate the macOS runner (`apps/macos-runner`) — it imports the shared
   engine and bundles its own browser.
5. Run the dependency-upgrade protocol checks
   (`docs/maintainers/dependency-upgrade-protocol.md`): overrides-drift,
   lockfile-floors, audit — and `npm run verify`.
6. **Pre-implementation gate:** confirm the exact `credentials` method
   signatures in the upgraded `node_modules/playwright-core/types/types.d.ts`
   (same grep used to prove 1.57 lacked it) before wiring the WebAuthn code
   below — do not code against assumed method names.

## Auth options that work on 1.57 today (no upgrade required)

These can be implemented before the upgrade and are the lower-risk half of §3.4.
They apply at context creation, which the session engine already centralizes in
`createBrowserTargetContext` (`apps/web/src/lib/runtime/test-runner.ts`) and
`setupExecutionTargets`:

- `newContext({ storageState })` — seed a previously captured signed-in state.
- `context.addCookies(cookies)` — inject session cookies.
- `newContext({ httpCredentials })` — HTTP basic auth.

Implementation sketch:

- Add `SessionAuthOptions` to `types/run-session.ts`:
  `{ storageState?, cookies?, httpCredentials?, webauthn? }`.
- Thread an optional `auth?: SessionAuthOptions` into
  `createBrowserTargetContext` / `setupExecutionTargets`; apply `storageState` /
  `httpCredentials` in the `newContext({...})` call and `addCookies` right after.
- Source the options from per-login-flow config. **All secret material**
  (storageState blobs, cookie values, http passwords, seeded credentials) must be
  **encrypted at rest** with `lib/security/crypto.ts` (AES-256-GCM,
  `ENCRYPTION_SECRET`) using the existing `*Encrypted` column pattern — never
  stored as plaintext `VARIABLE` config, and excluded from `configurationSnapshot`
  and runner event logs.
- SSRF: storageState origins and login-flow navigations must pass the same
  `validateRuntimeRequestUrl()` preflight as every other navigation.

## Native passkeys (requires 1.61, Phase 5 proper)

After the upgrade and the signature re-verification gate, in
`createBrowserTargetContext` after `newContext`:

```ts
if (auth.webauthn?.enabled) {
  // browserContext.credentials is the virtual WebAuthn authenticator for this
  // context. Seed a credential so a login flow can complete a passkey "get",
  // or let the flow register one via a "create" ceremony. Confirm exact method
  // names against the pinned version's types.d.ts before writing this.
  await context.credentials /* .addVirtualAuthenticator / .seed(...) */;
}
```

The virtual authenticator and any seeded credential live for the life of the
context, so a passkey registered during a login flow is usable by every reused
case in the same group session; on a context reset
(`closeBrowserTargetContext` + `createBrowserTargetContext` in the orchestrator)
it must be re-seeded. Seeding is engine-side (trusted) — keep it clear of the
`playwright-code` sandbox blocklist.

## Optional: session-state cache (§3.5)

After a login-flow member passes, `captureStorageState()` can persist the
(encrypted) storage state with an `expiresAt`; a later group run whose login flow
is unchanged and unexpired seeds `newContext({ storageState })` and skips the live
login. Deferred — v1 always runs the login flow live within each session; a stale
or missing cache falls back to a live login.
