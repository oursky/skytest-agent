# Documentation Index

This `docs/` folder contains two types of documentation:

- Operator / self-hosting docs: for people setting up and running this app on their own machines/servers
- Maintainer / coding-agent docs: for developers working on this repo and Android runtime behavior

## Operator / Self-Hosting Docs

Core app features can run without Android SDK/emulator tooling. Android operator docs below apply only when enabling Android testing on a host.

- `docs/operators/mac-android-emulator-guide.md`
  - macOS setup, emulator creation, operations, troubleshooting
- `docs/operators/android-runtime-deployment-checklist.md`
  - preflight checklist for enabling Android runtime on a host/environment

## Maintainer / Coding-Agent Docs

- `docs/maintainers/coding-agent-maintenance-guide.md`
  - code map, invariants, and maintenance traps for queue/emulator runtime
- `docs/maintainers/android-runtime-maintenance.md`
  - Android runtime behavior, isolation model, and operational constraints
- `docs/maintainers/test-case-excel-format.md`
  - current import/export Excel format contract and compatibility policy

## Design Notes / Plans

- `docs/plans/`
  - implementation plans and design notes used during feature development
  - useful for historical context, but not a stable contract

## Maintenance Guidance

- Prefer treating operator docs and maintainer docs as separate audiences.
- When runtime behavior changes (queueing, emulator cleanup, isolation, API visibility), update both:
  - operator runbooks/checklists
  - maintainer/runtime notes
- If import/export behavior changes, update `docs/maintainers/test-case-excel-format.md`.
