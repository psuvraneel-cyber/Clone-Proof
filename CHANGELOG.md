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

## [0.1.1] - 2026-10-30

### Changed

- The GitHub Action is named `CloneProof Check` so it can be listed on the
  GitHub Marketplace, where the name `Cloneproof` belongs to a different
  project. The `uses: psuvraneel-cyber/Clone-Proof@<ref>` reference, inputs,
  and outputs are unchanged.

### Fixed

- `ENV_EXAMPLE_MISSING` / `ENV_KEY_MISSING`: committed root `.env` files
  (for example `.env.development` or `.env.default`) now count as
  documentation. Only key names are read; values are never stored or
  reported. Gitignored local `.env` files still do not count.
- Environment checks no longer report keys that a framework or build tool
  sets itself: Vite's `import.meta.env` `MODE`, `BASE_URL`, `PROD`, `DEV`,
  and `SSR`; WXT, Astro, create-react-app, and Next.js keys when that
  framework is a dependency; and keys injected through a build-time define
  map such as webpack `DefinePlugin`.
- `BROWSER_TESTS_DETECTED` no longer fires just because Playwright or a
  Vitest browser package is installed. Vitest now counts only when the test
  command passes `--browser` or a configuration it loads sets
  `browser.enabled: true`. Dedicated browser runners are reported as before.

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
- Versioned reproducibility receipts (`receiptVersion: 1`): `--receipt FILE`
  on `check` and `verify`, `cloneproof receipt verify <file>`, and Action
  `receipt-path` / `receipt-status` outputs. The SHA-256 digest detects
  accidental changes; it is not a signature. See [docs/RECEIPTS.md](docs/RECEIPTS.md).
- Release tarballs built by CI from version tags, published with
  `SHA256SUMS` and a build-provenance attestation; see
  [docs/RELEASING.md](docs/RELEASING.md).

### Security

- Repository targets are treated as untrusted input; see
  [docs/SECURITY.md](docs/SECURITY.md) for the trust boundary and its limits.
  Docker is not a complete sandbox, and `--allow-network` should be used only
  for trusted repositories.

[Unreleased]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/psuvraneel-cyber/Clone-Proof/releases/tag/v0.1.0
