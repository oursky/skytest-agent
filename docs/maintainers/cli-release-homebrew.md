# CLI Release And Homebrew Flow

This runbook defines how to release the macOS `skytest` CLI and publish Homebrew-installable artifacts.

## Versioning

Use Semantic Versioning tags:

- stable: `vMAJOR.MINOR.PATCH`
- prerelease: `vMAJOR.MINOR.PATCH-rc.N`

Examples:

- `v1.2.3`
- `v1.3.0-rc.1`

## Release Trigger

The workflow is `.github/workflows/release-cli.yml`.

It can be triggered by:

- pushing a tag (`v*`)
- manual dispatch with input version (`v1.2.3` or `1.2.3`)

The workflow validates SemVer and normalizes to `v<version>` as the release tag.

## Release Artifacts

For each release, the workflow publishes:

- `skytest-<version>-darwin-arm64.tar.gz`
- `skytest-<version>-darwin-amd64.tar.gz`
- `checksums.txt`
- `skytest.rb` (rendered Homebrew formula)

## Homebrew Tap Auto-Update

Optional formula auto-update runs when secret `HOMEBREW_TAP_PAT` is configured.

Configure:

- repository variable `HOMEBREW_TAP_REPO` (default fallback: `oursky/homebrew-skytest`)
- repository secret `HOMEBREW_TAP_PAT` with push access to the tap repo

The workflow will commit `Formula/skytest.rb` to the configured tap.

## Operational Steps

1. Pick next SemVer version.
2. Create and push release tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

3. Wait for `Release CLI` workflow success.
4. Verify GitHub release assets are present.
5. Verify Homebrew formula updated in tap (if PAT configured).
6. Verify install on macOS:

```bash
brew tap oursky/skytest
brew install skytest
skytest version
```

## Rollback

If a release is bad:

1. Keep the bad tag/release immutable (do not overwrite history).
2. Publish a new patch release (for example `v1.2.4`).
3. Update tap formula to point to the fixed patch release.

## Notes

- Formula test uses `skytest version` to assert the packaged version.
- Release assets are architecture-specific for Apple Silicon and Intel macOS.
