# Changelog

All notable changes to CloneProof are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is
`0.x`, a minor release may change finding codes, statuses, or exit behavior;
each such change is listed here.

Compatibility contracts: report `schemaVersion` 2, the finding codes in
[docs/FINDINGS.md](docs/FINDINGS.md), and exit codes `0` (passed), `1` (failed),
and `2` (blocked or incomplete).

## [Unreleased]

## [0.1.0] - 2026-10-30

First tagged release.

### Added

- `cloneproof check <path-or-github-url>`: read-only static inspection of a
  Node.js/TypeScript repository root. It never runs repository code. Public
  GitHub URLs get a size and visibility preflight, then one isolated shallow
  clone with an empty Git configuration.
- `cloneproof verify --docker --execute`: opt-in `npm ci --ignore-scripts` and
  `npm test` inside the pinned image
  `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`,
  with no network by default, a non-root user, dropped capabilities, a
  read-only source mount, resource limits, and guaranteed cleanup.
- `cloneproof setup` to prepare the pinned verifier image explicitly.
- Deterministic text, JSON (schema version 2), and self-contained HTML reports
  with relative paths, explicit `coverage.checked` / `coverage.notChecked`
  lists, and bounded evidence.
- 86 documented finding codes, including `VERIFY_NO_TESTS_RAN`, which fails a
  verification whose test command exits `0` without running any tests.
- A native GitHub Action (`node24`) with `check` and `verify` modes,
  workflow annotations, and a Job Summary. Docker verification from the Action
  runs only on Linux runners for `push` and `workflow_dispatch` events.
- Release tarballs built by CI from version tags, published with
  `SHA256SUMS` and a build-provenance attestation; see
  [docs/RELEASING.md](docs/RELEASING.md).

### Security

- Repository targets are treated as untrusted input; see
  [docs/SECURITY.md](docs/SECURITY.md) for the trust boundary and its limits.
  Docker is not a complete sandbox, and `--allow-network` should be used only
  for trusted repositories.

[Unreleased]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/psuvraneel-cyber/Clone-Proof/releases/tag/v0.1.0
