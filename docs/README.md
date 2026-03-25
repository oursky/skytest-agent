# Documentation

This repository keeps durable documentation in two tracks:

- `docs/operators/` for people who run SkyTest locally or in shared environments
- `docs/maintainers/` for developers changing runtime, protocol, or import/export behavior

## Start Here

- [Local development](./operators/local-development.md)
- [Infrastructure and local services](../infra/README.md)
- [Android runtime deployment checklist](./operators/android-runtime-deployment-checklist.md)
- [macOS Android runner guide](./operators/macos-android-runner-guide.md)
- [macOS runner environment](./operators/macos-runner-environment.md)

## Maintainer References

- [Coding agent maintenance guide](./maintainers/coding-agent-maintenance-guide.md)
- [Android runtime maintenance](./maintainers/android-runtime-maintenance.md)
- [Runner queue diagnostics](./maintainers/runner-queue-diagnostics.md)
- [Performance observability reference](./maintainers/performance-observability-reference.md)
- [Frontend runtime debugging](./maintainers/frontend-runtime-debugging.md)
- [MCP server tooling](./maintainers/mcp-server-tooling.md)
- [CLI release and Homebrew flow](./maintainers/cli-release-homebrew.md)
- [Test case Excel import/export format](./maintainers/test-case-excel-format.md)
- [Dependency lifecycle policy](./maintainers/dependency-lifecycle-policy.md)

## Maintenance Rules

- Keep operator docs and maintainer docs aligned when runtime behavior changes.
- Use relative links inside the repository instead of branch-specific GitHub URLs.
- Update [test-case-excel-format.md](./maintainers/test-case-excel-format.md) whenever import or export behavior changes.
