# CloneProof public-repository field test

## Scope and method

This field test was planned on 2026-10-17 (IST) from CloneProof commit `f5d15f9` on the `field-test` branch, created from `main` at `2fcd8d1`. The run set contains 15 reputable public repositories and includes all required categories from the field-test brief except the unavailable TypeScript-Node-Starter repository, which was replaced before running CloneProof.

The pre-run expectations below were written before any CloneProof command was run against these repositories. Root package manifests, default branches, lockfile names, root `.env.example` presence, and default-branch GitHub Actions results were inspected through public GitHub pages/raw files and read-only `git ls-remote --symref ... HEAD`. No target repository was installed or tested on the host.

Each GitHub URL run is expected to make one unauthenticated GitHub size/visibility request. `check` is expected to clone only the shallow checkout; `verify` is expected to execute only inside CloneProof's pinned Docker profile. The network-allowed verification runs explicitly permit the target's npm install and test process to reach the internet inside that container.

## Pre-run repository inspection and expectations

| # | Repository / branch | Root inspection before CloneProof | Latest default-branch Actions run | Expected `check` | Expected `verify` |
|---:|---|---|---|---|---|
| 1 | `psuvraneel-cyber/Clone-Proof` / `main` | Node package; npm `package-lock.json`; root `.env.example`; `test` runs build plus `node --test`; Node `>=22.19.0`. | No workflow runs returned. | `passed`; no blocking finding. | No-network `passed` and network-allowed `passed`. |
| 2 | `tj/commander.js` / `master` | ESM npm package; `package-lock.json`; no root `.env.example`; `test` runs `node --test` plus TypeScript checks; Node `>=22.12.0`. | `CodeQL`, `success`, head `ba6d13ddb424`. | `passed`; lockfile and test script present. | No-network blocked for external dependencies; network-allowed expected `passed`. |
| 3 | `motdotla/dotenv` / `master` | npm package; `package-lock.json`; no root `.env.example`; `test` builds, lints, type-checks, and runs Tap; Node `>=12`. | `CI`, `success`, head `6d6e6c58074a`. | `passed`; lockfile and Tap test script present. | No-network blocked for external dependencies; network-allowed expected `passed`. |
| 4 | `typestack/class-validator` / `develop` | TypeScript npm package; `package-lock.json`; no root `.env.example`; `test` runs Jest coverage; no package engine declaration observed. | `Lock inactive threads`, `failure`, head `2e1a5c27dbd6`. | `passed`; TypeScript root and Jest test script. | No-network blocked for external dependencies; network-allowed expected `passed`. |
| 5 | `expressjs/express` / `master` | npm package; no root lockfile; no root `.env.example`; `test` runs Mocha; Node `>=18`. | `CodeQL`, `action_required`, head `8206d4459dee` (latest run returned for `master`). | `passed_with_warnings`; `LOCKFILE_MISSING`. | Blocked before Docker because `npm ci` requires a lockfile. |
| 6 | `sindresorhus/slugify` / `main` | Small ESM npm package; no root lockfile; no root `.env.example`; `test` runs XO and AVA; Node `>=20`. | `CI`, `success`, head `3b17b2e84b97`. | `passed_with_warnings`; `LOCKFILE_MISSING`. | Blocked before Docker because `npm ci` requires a lockfile. |
| 7 | `typeorm/typeorm` / `master` *(swap for unavailable TypeScript-Node-Starter)* | TypeScript monorepo; pnpm `pnpm-lock.yaml`; no root `.env.example`; root `test` delegates to the TypeORM package and external database-backed suites; `packageManager` is pnpm. | `Publish Package`, `failure`, head `fe9239428751`. | Expected `passed` or `passed_with_warnings`; package-manager metadata and root test script visible. | Blocked by the npm-only Docker profile; external database requirement is not expected to be executed. |
| 8 | `kelektiv/node.bcrypt.js` / `master` | npm native module; `package-lock.json`; no root `.env.example`; `test` runs Jest and `install` runs `node-gyp-build`; Node `>=18`. | `ci`, `success`, head `24aa3c50a990`. | `passed`; lockfile and test script present. | No-network blocked for external dependencies; network-allowed expected to fail or be misleading because `--ignore-scripts` skips native installation. |
| 9 | `axios/axios` / `v1.x` | ESM npm package; `package-lock.json`; no root `.env.example`; `test` runs Vitest and devDependencies include Playwright/browser projects; root `prepare` runs Husky. | `Code Quality: Scheduled`, `success`, head `326843a3902d`. | `passed` or `passed_with_warnings`; lockfile and test script present. | No-network blocked for external dependencies; network-allowed expected to fail in browser-dependent test paths. |
| 10 | `vuejs/core` / `main` | TypeScript monorepo; pnpm `pnpm-lock.yaml`; no root `.env.example`; `test` runs Vitest; `packageManager` is pnpm and `preinstall` rejects npm. | `ecosystem-ci trigger`, `skipped`, head `bf5f0dd8773d`. | Expected `passed` or `passed_with_warnings`; pnpm package metadata visible. | Blocked by the npm-only Docker profile. |
| 11 | `facebook/react` / `main` | Yarn classic workspace; `yarn.lock`; no root `.env.example`; `test` runs the custom Jest launcher; `packageManager` is Yarn 1.22.22. | `(Runtime) Fuzz tests`, `success`, head `098d2e87a1f7`. | Expected `passed` or `passed_with_warnings`; Yarn lockfile and test script visible. | Blocked by the npm-only Docker profile. |
| 12 | `jestjs/jest` / `main` | Yarn Berry workspace; `yarn.lock` and committed `.yarn/`; no root `.env.example`; `test` runs Yarn lint plus Jest; `packageManager` is Yarn 4.18.0. | `Close stale issues and PRs`, `success`, head `61050e9323e7`. | Expected `passed` or `passed_with_warnings`; `.yarn/` should be skipped by traversal. | Blocked by the npm-only Docker profile. |
| 13 | `npm/cli` / `latest` | npm workspace; package-lock expected; no root `.env.example`; `test` runs Tap and the root has committed/bundled workspace material; Node `^22.22.2 || ^24.15.0 || >=26.0.0`. | `CI`, `success`, head `ae98c62586b6`. | Expected `GITHUB_CHECKOUT_LIMIT_EXCEEDED` or another clear bounded-checkout block if the current checkout exceeds CloneProof limits. | Not run if `check` blocks. |
| 14 | `torvalds/linux` / `master` | C/Linux kernel tree; no `package.json`, npm lockfile, or root `.env.example`; no Node test script. | `pip in /Documentation/sphinx for Jinja2`, `failure`, head `66fb95a52111`. | `blocked`; `UNSUPPORTED_ROOT` identifying a non-Node root. | Not run because static inspection blocks. |
| 15 | `pallets/flask` / `main` | Python project; no `package.json`, npm lockfile, or root `.env.example`; Python packaging metadata and Python tests. | `Lock inactive closed issues`, `success`, head `d086db856be1`. | `blocked`; `UNSUPPORTED_ROOT` identifying Python. | Not run because static inspection blocks. |

### Repository swap

`microsoft/TypeScript-Node-Starter` was replaced before field testing because the public repository URL returned `Repository not found` from read-only `git ls-remote`. `typeorm/typeorm` is a similarly well-known TypeScript/Node repository whose root test workflow depends on pnpm and database-backed integrations, so it preserves the external-service/package-manager stress case. The original suggestion and the swap are retained here rather than silently changing the test set.

## Results

This section is intentionally completed only after the pre-run expectations above have been committed and the CloneProof runs have finished. Each row will record the checked commit, exit code, finding codes, duration, and a verdict of `correct`, `false pass`, `false fail`, `wrong status`, or `tool error`.

## Known limitations

To be completed from observed field-test evidence. A limitation is recorded here only when it is not fixed with a small regression-tested change during this field test.
