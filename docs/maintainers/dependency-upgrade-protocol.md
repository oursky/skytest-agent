# Dependency Upgrade Protocol

**Audience:** Any engineer or coding agent patching a vulnerability, adding an npm override, or pinning a transitive dependency.

## When this applies

- Patching a Dependabot alert that lives in a transitive dependency.
- Adding or modifying `overrides` in `package.json` or `apps/web/package.json`.
- Bumping a direct dependency that drags vulnerable transitives.
- Investigating why an `npm install` refuses to resolve a requested version.

## Why we have a protocol

We have been burned by two failure modes:

1. **Shotgun override editing.** Trying override syntaxes (nested object, dotted, version-scoped, workspace-level) serially against the real repo tree. This is slow, pollutes `package-lock.json` with partial resolutions, and makes it hard to tell which syntax actually worked.
2. **Silent regression on bump.** Version-scoped override keys like `@midscene/core@1.7.4` stop matching when `@midscene/core` is bumped, and the transitive vulnerable version comes back unnoticed because `scripts/security/audit-ci.mjs` allowlists the advisory.

The steps below eliminate both.

## Protocol

### Step 1 — Reproduce in isolation first

Before editing the real repo tree:

```bash
tmpdir=$(mktemp -d) && cd "$tmpdir"
npm init -y >/dev/null
# Replicate only the dependency shape relevant to the problem.
# Use the same workspace layout if workspace overrides are involved.
mkdir -p apps/web
cd apps/web && npm init -y >/dev/null && npm pkg set name=@x/web
# ...declare dependencies and overrides...
npm install
npm ls <package> --all
```

Confirm the override syntax actually produces the desired resolution **in the isolated tree**. Only then edit the real repo.

### Step 2 — Prefer stable override shapes

Order of preference:

1. **Top-level override** — `"<pkg>": "<floor>"`. Survives all direct-dep bumps.
2. **Parent-scoped override** — `"<parent>": { "<pkg>": "<floor>" }`. Survives parent-version bumps.
3. **Version-scoped override** — `"<parent>@<version>": { "<pkg>": "<floor>" }`. **Avoid if possible.** Stops matching silently when `<parent>` is bumped. If you must use it, add a comment in `package.json` explaining the constraint and pair it with the lockfile floor guard (see Step 4).

### Step 3 — Apply to both root and apps/web if shared

If the override affects dependencies present in both root and `apps/web`, update both `package.json` files so they agree. `scripts/quality/check-overrides-drift.mjs` enforces this; align the values or update `scripts/quality/overrides-drift-allowlist.json` with justification.

### Step 4 — Verify the lockfile floor

Run:

```bash
npm install
npm run --workspace @skytest/web security:check-lockfile-floors
```

This script walks every `node_modules/**` path in `package-lock.json` and fails if any entry is below the minimum known-safe version.

If it fails, do **not** work around it by hand-editing `package-lock.json`. Either:
- add the correct override in `package.json` (Step 2);
- or bump the parent dependency to a release that already carries the safe transitive.

### Step 5 — Update floor table if patching a new CVE

If you are adding a new floor (e.g. a fresh advisory), update `FLOORS` in `apps/web/scripts/security/check-locked-min-versions.mjs`. Include:

- package name (as it appears in `package-lock.json`);
- minimum safe version;
- short justification comment referencing the advisory.

### Step 6 — Run full verify

```bash
npm run verify
```

If `verify` fails, **do not describe the failure by guess**. Run:

```bash
npm run --workspace @skytest/web verify:explain
```

which prints a `VERIFY_FAILURE` block with the exact failing checker. Attribute the failure by that checker name, not by assumption. Never commit on top of a red `main`.

## Anti-patterns

- **Hand-editing `package-lock.json`** with `node -e ...` to delete subtrees. Works today, fails on the next `npm install --force` or dependency bump. If the override system can't express what you need, the correct fix is a parent-version bump, a fork, or a documented exception — not surgery.
- **Editing overrides serially against the real tree** to find a working syntax. Use Step 1.
- **Blindly allowlisting** advisories in `scripts/security/audit-ci.mjs`. The allowlist exists for upstream advisories we are waiting on; do not add entries to silence our own regressions. The lockfile floor guard (Step 4) is the durable catch.
- **Dismissing `verify` failures** as "pre-existing, unrelated" without running `verify:explain`. Prior incident: a hotspot LOC failure was described as "React hooks lint errors" and the branch shipped red.

## References

- `apps/web/scripts/security/check-locked-min-versions.mjs` — lockfile floor guard.
- `apps/web/scripts/quality/check-overrides-drift.mjs` — override drift guard.
- `apps/web/scripts/quality/explain-verify-failure.mjs` — verify failure attribution.
- `docs/maintainers/agent-session-rules.md` — agent session rules.
