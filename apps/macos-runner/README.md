# macOS Runner

Headless runner agent for Android execution.
This runtime is managed by the `skytest-runner` CLI and is not started directly in normal workflows.

Setup, environment, and lifecycle are driven through the CLI. For the runtime and isolation model
this agent implements, see [android-runtime-maintenance.md](../../docs/maintainers/android-runtime-maintenance.md).

From a source checkout, invoke the CLI through the root workspace script:

```bash
npm run skytest-runner -- <command>
```

For Homebrew installs, invoke `skytest-runner` directly.
