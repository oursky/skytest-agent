# Repository Hygiene

This note defines which repository artifacts are durable source, regenerable
output, or local data. The goal is to keep cleanup safe and prevent local test
evidence from entering container images.

## Cleanup Tiers

- `make clean` removes only regenerable build, test, and TypeScript artifacts.
- `make clean-data` removes the ignored local SQLite database and uploaded test
  data. Run it only when that local data is disposable.
- `make clean-deps` removes installed workspace dependencies. Restore them with
  `npm install`.

Do not add local data or dependency deletion to the default `clean` target.

## Docker Build Context

Generated artifacts ignored by Git must also be considered for `.dockerignore`.
In particular, keep build output, dependency trees, Midscene/Playwright evidence,
uploads, runtime lock files, editor state, and environment files outside the
Docker build context.

Do not ignore durable runtime configuration such as a deliberately committed
`.skytest/skytest.yaml`.

## Durable Repository Content

Keep operational scripts that are invoked by package scripts, Make targets,
GitHub workflows, release tooling, or documented runbooks. Keep Prisma migrations,
the package lockfile, runner protocol sources, and product-linked SkyTest skills.

Before deleting a seemingly unreferenced script or document, check package
manifests, hidden workflow files, Make targets, and product links.

## Validation

After changing cleanup or ignore rules:

1. Dry-run cleanup targets with `make -n`.
2. Run `git diff --check`.
3. Run `npm test`.
4. Run `npm run verify`.
