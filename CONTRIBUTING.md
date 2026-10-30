# Contributing to CloneProof

Thanks for helping make fresh clones less painful. Bug reports, false-positive
reports, documentation fixes, and code are all welcome.

## Before you start

- **Found a wrong finding?** Open a [false-positive report](https://github.com/psuvraneel-cyber/Clone-Proof/issues/new?template=false_positive.yml).
  These are the most useful reports right now: field test Run 5 showed that
  `ENV_EXAMPLE_MISSING` and `BROWSER_TESTS_DETECTED` are noisy in the wild
  (see [docs/FIELD_TEST.md](docs/FIELD_TEST.md)).
- **Security issue?** Don't open a public issue; follow [SECURITY.md](SECURITY.md).
- **Larger change?** Open an issue or a [discussion](https://github.com/psuvraneel-cyber/Clone-Proof/discussions)
  first so the approach can be agreed before you write code.

## Development setup

Requirements: Node.js ≥ 22.19.0 (see `.nvmrc`) and npm. Docker is only needed
to run `verify` by hand; the test suite is offline and uses injected runners.

```bash
git clone https://github.com/psuvraneel-cyber/Clone-Proof.git
cd Clone-Proof
npm ci
npm test              # offline suite
npm run test:leaks    # same suite with an isolated temp folder; fails on leftover files
node src/cli.js check examples/healthy-node
```

## Ground rules

These are product guarantees, not style preferences. A pull request that weakens
one needs an explicit design discussion first.

- `check` never executes repository code: no scripts, README commands,
  lifecycle hooks, or target Dockerfiles. Local scans start no process.
- `verify` runs only inside the pinned, locked-down Docker profile, needs both
  `--docker` and `--execute`, and keeps the network off unless
  `--allow-network` is given. Never mount the Docker socket or pass host
  secrets into the container.
- CloneProof has **no runtime dependencies**. Use Node.js built-ins.
- Report schema version 2, the finding codes in [docs/FINDINGS.md](docs/FINDINGS.md),
  and exit codes `0` / `1` / `2` are contracts that scripts depend on. Don't
  rename or reuse a finding code; add a new one.
- Reports stay deterministic: relative paths, sorted output, no timestamps.

## Changing or adding a finding

1. Add a failing regression test first (`test/scan.test.js`, `test/verify.test.js`,
   or a focused file).
2. Make the change in `src/`.
3. For a new code, add a row to `docs/FINDINGS.md` and its coverage mapping in
   `src/report/coverage.js`; `test/finding-codes.test.js` enforces this.
4. Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
5. If the change affects which findings fire on real repositories, rerun the
   field-test sample (`node scripts/fieldtest.js run --sample docs/field-test/run5-sample.json --out <file>`)
   and mention the before/after counts in the pull request.

## Pull requests

- Keep each pull request focused, with small commits whose messages say what
  changed and why.
- Run `npm test` before pushing. CI runs the suite on Ubuntu, macOS, and
  Windows, plus Docker and Action end-to-end jobs on `main`.
- Update the README or `docs/` when behavior or output changes.
- Releases are cut by maintainers from version tags; see [docs/RELEASING.md](docs/RELEASING.md).

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
