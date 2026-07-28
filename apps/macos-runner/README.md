# macOS Runner

Headless runner agent for Android execution.
This runtime is managed by the `skytest-runner` CLI and is not started directly in normal workflows.

Use the canonical operator documentation for setup, environment, and lifecycle commands:

- [macOS Android runner guide](../../docs/operators/macos-android-runner-guide.md)
- [macOS runner environment](../../docs/operators/macos-runner-environment.md)

From a source checkout, invoke the CLI through the root workspace script:

```bash
npm run skytest-runner -- <command>
```

For Homebrew installs, invoke `skytest-runner` directly.
