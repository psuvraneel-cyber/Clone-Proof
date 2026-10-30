# Releasing CloneProof

Releases are immutable Git tags named `vX.Y.Z`. Pushing a tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds
the npm tarball on Linux, attests its build provenance, publishes a GitHub
release with the tarball and `SHA256SUMS` attached, and publishes the same
tarball to npm as [`cloneproof-check`](https://www.npmjs.com/package/cloneproof-check)
with npm provenance. Nothing is published by hand.

The npm package is `cloneproof-check` because the name `cloneproof` belongs to a
different project, and npm rejects `clone-proof` as too similar to it. The
command it installs is still `cloneproof`.

## npm credentials

The **Publish to npm** step reads the `NPM_TOKEN` Actions secret: a granular
npm access token, from an account with two-factor authentication, that can
publish `cloneproof-check`. Once the package exists you can instead configure npm
trusted publishing for this repository and `release.yml`, then delete the
token.

## Versioning

- Versions follow Semantic Versioning. While the version is `0.x`, a minor
  release may change finding codes, statuses, or exit behavior, and the
  changelog must say so.
- There is no moving major tag (`v0`, `v1`) while the version is `0.x`. Users
  pin `@vX.Y.Z` or the release commit SHA.
- A published tag is never moved or deleted. Mistakes are fixed forward with a
  new patch release.

## Steps

1. On a branch, set `version` in `package.json`, move the `[Unreleased]`
   entries in `CHANGELOG.md` into a `## [X.Y.Z] - YYYY-MM-DD` section, update
   the compare links at the bottom, and update every documented
   `psuvraneel-cyber/Clone-Proof@v…` reference and release download URL.
   `test/release.test.js` fails until all of these agree.
2. Check locally:

   ```bash
   node scripts/release-notes.js
   npm test
   ```

3. Merge the branch to `main` through a pull request with green CI.
4. Optional dry run: run the **Release** workflow from the Actions tab on
   `main` (`workflow_dispatch`). It runs every check and builds the tarball but
   publishes nothing.
5. Tag the merged commit and push the tag:

   ```bash
   git switch main
   git pull --ff-only
   git tag -a vX.Y.Z -m "CloneProof vX.Y.Z"
   git push origin vX.Y.Z
   ```

6. The workflow refuses tags that are not on `main` or that don't match
   `package.json`, runs the test suite, builds `cloneproof-check-X.Y.Z.tgz`, attests
   it, creates the GitHub release with the changelog section as its notes, and
   publishes the tarball to npm. If the npm step fails after the GitHub release
   exists, fix the cause and rerun the failed job; never move the tag.
7. From an empty folder, check that `npx cloneproof-check@X.Y.Z --version` prints
   the new version.

Build release tarballs only in CI. A tarball packed on a Windows checkout with
`core.autocrlf=true` can contain CRLF line endings, which break the
`#!/usr/bin/env node` line of `src/cli.js` on Linux and macOS.

## Verifying a release

```bash
sha256sum -c SHA256SUMS            # macOS: shasum -a 256 -c SHA256SUMS
gh attestation verify clone-proof-X.Y.Z.tgz --repo psuvraneel-cyber/Clone-Proof
```

The attestation shows that the tarball was built by this repository's Release
workflow from the tagged commit. It does not say anything about whether
CloneProof's findings are correct.
