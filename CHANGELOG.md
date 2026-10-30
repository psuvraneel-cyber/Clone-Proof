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

## [0.2.3] - 2026-10-31

### Changed

- CloneProof is published to npm as **`clone-proof`**: run
  `npx clone-proof check <path-or-url>` or `npm install -g clone-proof`. The
  installed command is still `cloneproof`, and reports and receipts still name
  the tool `cloneproof`. The npm name `cloneproof` belongs to a different
  project. The Release workflow publishes the same CI-built, attested tarball
  to npm with provenance; the GitHub release asset is now named
  `clone-proof-X.Y.Z.tgz`.
- Version 0.2.2 was prepared but never tagged or published; its changes
  ship in this release.

### Fixed

False findings measured in field test Run 6 (see
[docs/FIELD_TEST.md](docs/FIELD_TEST.md)):

- Environment checks no longer report keys that nobody configures for a
  repository: variables set by the operating system or shell (`HOMEPATH`,
  `PROGRAMFILES`, `OLDPWD`, `COMP_CWORD`, `XDG_*`), by Git while it runs hooks
  (`GIT_DIR`, `GIT_INDEX_FILE`), by CI services (`TRAVIS`, `TF_BUILD`,
  `CF_PAGES`, …), by Rollup (`ROLLUP_WATCH`, when Rollup is a dependency), and
  keys the repository's own code assigns, such as `process.env.WEBPACK_SERVE =
  'true'`.
- Environment keys mentioned only in comments or in `.d.ts` type declarations
  are no longer counted, and keys containing `$` are read whole
  (`process.env.Wimp$ScrapDir` was reported as `Wimp`).
- `NO_TESTS_FOUND` now recognizes shell test suites (`test.sh`, `test/*.sh`,
  Bats) and other languages' test files (Dart and Go `*_test`, Python
  `test_*`, Ruby `*_spec`). A repository with such tests and no test script
  fails with `TEST_SCRIPT_MISSING`, as it does for JavaScript tests.
- `ENGINES_NODE_UNSATISFIED` no longer misreads `engines.node` ranges with a
  space after the operator, such as `>= 24.10.0`.
- `PRIVATE_REGISTRY` no longer reports public npm mirrors (npmmirror, Tencent
  Cloud, Huawei Cloud).

## [0.2.1] - 2026-10-31

### Fixed

- `README_SCRIPT_UNKNOWN` no longer fails library READMEs that show readers
  how to use the package in their own project. A script defined in a fenced
  `"scripts": { ... }` example in the README, and missing from the root
  `package.json`, is reported under the informational
  `README_OTHER_PROJECT_COMMANDS` instead. `npm run` commands that appear as
  quoted values in README configuration examples (for example
  `"cover": "npm run cover:unit"`) are no longer treated as commands. In field
  test Run 6, all 9 `README_SCRIPT_UNKNOWN` findings were of these kinds, and
  the repositories failing `check` fell from 6 to 1 (see
  [docs/FIELD_TEST.md](docs/FIELD_TEST.md)).

## [0.2.0] - 2026-10-30

### Changed

- **Exit behavior:** a repository with no tests no longer fails `check`. When
  there is no test script (or only npm's placeholder) and no test files or
  README test instructions, CloneProof reports the new `NO_TESTS_FOUND`
  warning instead of failing with `TEST_SCRIPT_MISSING` /
  `TEST_SCRIPT_PLACEHOLDER`. A missing or placeholder test script still fails
  when the repository has tests that `npm test` cannot run, and whenever the
  scan is incomplete. `verify` still requires a test script.
- For this decision, test files are `*.test.*`, `*.spec.*`, Cypress `*.cy.*`,
  files in `__tests__/`, and files under `test/` or `tests/` that use a test
  API. Other files under `test/` (dev playgrounds, examples) do not count.

### Added

- `--require-tests` for `check` and `verify`, and the Action input
  `require-tests`, to treat a repository without tests as failed.

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

[Unreleased]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.2.1...v0.2.3
[0.2.1]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/psuvraneel-cyber/Clone-Proof/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/psuvraneel-cyber/Clone-Proof/releases/tag/v0.1.0
