# CloneProof public-repository field test

## Scope and method

This field test was planned on 2026-10-17 (IST) from CloneProof commit `f5d15f9` on the `field-test` branch, created from `main` at `2fcd8d1`. The run set contains 15 reputable public repositories and includes all required categories from the field-test brief except the unavailable TypeScript-Node-Starter repository, which was replaced before running CloneProof.

The pre-run expectations below were written before any CloneProof command was run against these repositories. Root package manifests, default branches, lockfile names, root `.env.example` presence, and default-branch GitHub Actions results were inspected through public GitHub pages/raw files and read-only `git ls-remote --symref ... HEAD`. No target repository was installed or tested on the host.

Each GitHub URL run is expected to make one unauthenticated GitHub size/visibility request. The `check` results below are static inspection only and clone only the shallow checkout; `verify` is optional and executes only inside CloneProof's pinned Docker profile. The network-allowed verification runs explicitly permit the target's npm install and test process to reach the internet inside that container.

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

## Earlier rerun evidence (measured with earlier code; not comparable for finding-level counts)

This section was written before any rerun command below was started. The reruns use the four fixes on the `field-test-fixes` branch. Each result will record the status, exit code, principal finding codes, `target.commit`, `target.preflight`, and duration; repositories that cannot be cloned or are blocked by static prerequisites will not receive a Docker result.

| Repository | Commands | Expected after the fixes |
|---|---|---|
| `psuvraneel-cyber/Clone-Proof` | `check`; verify without network; verify with network | All three runs passed as the control. |
| `facebook/react` | `check`; both verifies | `check` passed or passed with warnings after the 4 GiB full-history sanity bound; both verifies blocked by the npm-only rule because the repository uses Yarn. |
| `tj/commander.js` | `check`; both verifies | Without network: `DOCKER_NETWORK_REQUIRED`; with network: blocked by `DOCKER_SYMLINKS_BLOCKED`, with the Git-listed fixture path reported consistently on Windows. |
| `motdotla/dotenv` | `check`; verify with network | Passed if the committed `.env` fixtures were the only cause of the earlier test failure. |
| `axios/axios` | `check`; verify with network | Still failed in the test phase because browser binaries are unavailable; record whether the committed TLS-fixture failures are gone. |
| `kelektiv/node.bcrypt.js` | `check`; verify with network | `check` no longer warns about install scripts; verify still failed, with the skipped-install-script explanation. |
| `torvalds/linux` | `check` only while the GitHub size check is available | Blocked with `GITHUB_REPOSITORY_TOO_LARGE` before cloning; `target.preflight` is `checked`. |

The other first-run repositories did not report `INSTALL_SCRIPTS_SKIPPED`; no additional check-only rerun is required beyond the repositories listed above.

## Earlier warning precision (measured with a different set of checks; not comparable to Run 3)

The environment-warning rerun used the eight repositories named in the review request. The “warning” unit below is a warning finding, not an individual environment key; keys are shown in brackets so the reason for each judgment is auditable. “Real” means that a person setting up or verifying the repository genuinely needs the information. “Noise” means that the reference is optional tooling/configuration, a conventional process variable, or a limitation already represented by a more direct finding.

| Repository | Warnings before | Warnings after | Judgment and reason |
|---|---|---|---|
| `tj/commander.js` | `ENV_EXAMPLE_MISSING` [`CLICOLOR_FORCE`, `PORT`] — **noise** | none | `CLICOLOR_FORCE` is a conventional color variable and `PORT` is example-hook tooling, not required root setup. |
| `motdotla/dotenv` | `ENV_EXAMPLE_MISSING` [`DEBUG`, `DOTENV_CONFIG_QUIET`, `DOTENV_QUIET`] — **noise** | `ENV_EXAMPLE_MISSING` [`DOTENV_CONFIG_QUIET`, `DOTENV_QUIET`] — **noise** | These are optional dotenv/configuration switches; the package does not require them to install or run its test workflow. `DEBUG` is removed as a conventional key. |
| `axios/axios` | `ENV_EXAMPLE_MISSING` [`NO_PROXY`, `no_proxy`] — **noise** | `BROWSER_TESTS_DETECTED` — **real**; `ENV_EXAMPLE_MISSING` [`NO_PROXY`, `no_proxy`] — **noise** | Browser tooling is a real limitation of the controlled image; proxy bypass variables are conventional host configuration, not setup requirements. |
| `expressjs/express` | `LOCKFILE_MISSING` — **real** | `LOCKFILE_MISSING` — **real** | A fresh clone cannot reproduce dependency versions without a root lockfile. |
| `sindresorhus/slugify` | `LOCKFILE_MISSING` — **real** | `LOCKFILE_MISSING` — **real** | A fresh clone cannot reproduce dependency versions without a root lockfile. |
| `vuejs/core` | `ENV_EXAMPLE_MISSING` [`COMMIT`, `FORMATS`, `PROD_ONLY`, `SOURCE_MAP`, `TARGET`, `TARGETS`, `__DEV__`] — **noise** | `BROWSER_TESTS_DETECTED` — **real** | The variables are root Rollup build configuration, excluded by the root-config rule; browser dependencies are relevant to verification limits. |
| `facebook/react` | none (preflight blocked before scan) | none | No warning finding was produced in either run. |
| `jestjs/jest` | `ENV_EXAMPLE_MISSING` [`GLOBALS_CLEANUP`] — **noise** | none | `GLOBALS_CLEANUP` is in `jest.config.mjs`, a root config file excluded from environment documentation checks. |

| Run | Real warnings | All warnings | Noise warnings | Precision |
|---|---:|---:|---:|---:|
| Before filtering | 2 | 7 | 5 | 2 / 7 = **28.6%** |
| After filtering | 4 | 6 | 2 | 4 / 6 = **66.7%** |

The “before” values are the original `reports/field/*-check.json` observations. The “after” values are the fresh JSON reruns saved locally as `reports/field/{commander,dotenv,axios,express,slugify,vue,react,jest}-check-after-env.json`; those generated reports remain ignored so the repository does not accumulate machine-specific checkout evidence. The after rerun commands were `node src/cli.js check <URL> --format json --output <report>` and all eight GitHub preflights were `checked`; no target repository code was executed.

## Planted-bug test (static inspection only)

The offline suite in `test/planted-bugs.test.js` builds a realistic Node.js project in the operating-system temporary directory, confirms the healthy base is `passed`, then copies it for each single mutation. It covers the 13 requested mutations, including a whitespace-only README control. The suite runs `scanRepository` only; it is part of `npm test` and never starts a target process.

The separate real-repository extension used read-only `git clone --depth 1` for `psuvraneel-cyber/Clone-Proof`, `typestack/class-validator`, and `motdotla/dotenv`, removed each checkout's `.git` directory, copied each checkout for every mutation, and invoked `node src/cli.js check <copy> --format json`. It is a manual, network-dependent field procedure rather than part of `npm test`; no target `npm`, test, build, lifecycle, or Docker command was run. Adaptations were recorded rather than silently omitted:

- Bug 1 seeded one `devDependencies.planted-dependency` entry in both the CloneProof manifest and lockfile root because that repository has no root dependency, then removed only the lockfile entry.
- Bug 4 added an `npm run build` README line to class-validator and dotenv because their READMEs had no npm script line before the build-script rename.
- Bug 5 added a minimal `.env.example` without the planted key to class-validator and dotenv because those repositories had no environment template.
- Bug 6 added `engines.node: >=22.0.0` to class-validator because it had no engine declaration; dotenv used `.nvmrc: 10` against its existing `engines.node: >=12`.

| Repository | Bug | Detected | Finding code | Adaptation / control note |
|---|---:|:---:|---|---|
| `psuvraneel-cyber/Clone-Proof` | 1 | yes | `LOCKFILE_OUT_OF_SYNC` | Seeded one root dev dependency, then removed its lock entry. |
| `psuvraneel-cyber/Clone-Proof` | 2 | yes | `TEST_SCRIPT_MISSING` | — |
| `psuvraneel-cyber/Clone-Proof` | 3 | yes | `TEST_SCRIPT_PLACEHOLDER` | — |
| `psuvraneel-cyber/Clone-Proof` | 4 | yes | `README_SCRIPT_UNKNOWN` | — |
| `psuvraneel-cyber/Clone-Proof` | 5 | yes | `ENV_KEY_MISSING` | — |
| `psuvraneel-cyber/Clone-Proof` | 6 | yes | `RUNTIME_VERSION_MISMATCH`, `ENGINES_NODE_UNSATISFIED` | — |
| `psuvraneel-cyber/Clone-Proof` | 7 | yes | `CORE_FILE_GITIGNORED` | — |
| `psuvraneel-cyber/Clone-Proof` | 8 | yes | `LOCKFILE_MISSING` | — |
| `psuvraneel-cyber/Clone-Proof` | 9 | yes | `PACKAGE_JSON_INVALID` | — |
| `psuvraneel-cyber/Clone-Proof` | 10 | yes | `PRIVATE_REGISTRY` | Secret value was absent from the report. |
| `psuvraneel-cyber/Clone-Proof` | 11 | yes | `README_PACKAGE_MANAGER_MISMATCH` | — |
| `psuvraneel-cyber/Clone-Proof` | 12 | yes | `PACKAGE_MANAGER_LOCKFILE_MISMATCH` | — |
| `psuvraneel-cyber/Clone-Proof` | 13 | yes | no new finding | Whitespace-only README control. |
| `typestack/class-validator` | 1 | yes | `LOCKFILE_OUT_OF_SYNC` | — |
| `typestack/class-validator` | 2 | yes | `TEST_SCRIPT_MISSING` | — |
| `typestack/class-validator` | 3 | yes | `TEST_SCRIPT_PLACEHOLDER` | — |
| `typestack/class-validator` | 4 | yes | `README_SCRIPT_UNKNOWN` | Added the needed `npm run build` line. |
| `typestack/class-validator` | 5 | yes | `ENV_KEY_MISSING` | Added a template without the planted key. |
| `typestack/class-validator` | 6 | yes | `ENGINES_NODE_UNSATISFIED` | Added `engines.node: >=22.0.0`, then pinned `.nvmrc` to 20. |
| `typestack/class-validator` | 7 | yes | `CORE_FILE_GITIGNORED` | — |
| `typestack/class-validator` | 8 | yes | `LOCKFILE_MISSING` | — |
| `typestack/class-validator` | 9 | yes | `PACKAGE_JSON_INVALID` | — |
| `typestack/class-validator` | 10 | yes | `PRIVATE_REGISTRY` | Secret value was absent from the report. |
| `typestack/class-validator` | 11 | yes | `README_PACKAGE_MANAGER_MISMATCH` | — |
| `typestack/class-validator` | 12 | yes | `PACKAGE_MANAGER_LOCKFILE_MISMATCH` | — |
| `typestack/class-validator` | 13 | yes | no new finding | Whitespace-only README control. |
| `motdotla/dotenv` | 1 | yes | `LOCKFILE_OUT_OF_SYNC` | — |
| `motdotla/dotenv` | 2 | yes | `TEST_SCRIPT_MISSING` | — |
| `motdotla/dotenv` | 3 | yes | `TEST_SCRIPT_PLACEHOLDER` | — |
| `motdotla/dotenv` | 4 | yes | `README_SCRIPT_UNKNOWN` | Added the needed `npm run build` line. |
| `motdotla/dotenv` | 5 | yes | `ENV_KEY_MISSING` | Added a template without the planted key. |
| `motdotla/dotenv` | 6 | yes | `ENGINES_NODE_UNSATISFIED` | Used `.nvmrc: 10` against existing `engines.node: >=12`. |
| `motdotla/dotenv` | 7 | yes | `CORE_FILE_GITIGNORED` | — |
| `motdotla/dotenv` | 8 | yes | `LOCKFILE_MISSING` | — |
| `motdotla/dotenv` | 9 | yes | `PACKAGE_JSON_INVALID` | — |
| `motdotla/dotenv` | 10 | yes | `PRIVATE_REGISTRY` | Secret value was absent from the report. |
| `motdotla/dotenv` | 11 | yes | `README_PACKAGE_MANAGER_MISMATCH` | — |
| `motdotla/dotenv` | 12 | yes | `PACKAGE_MANAGER_LOCKFILE_MISMATCH` | — |
| `motdotla/dotenv` | 13 | yes | no new finding | Whitespace-only README control. |

| Scope | Detected | Total | Detection rate |
|---|---:|---:|---:|
| Offline suite | 13 | 13 | **100%** |
| `psuvraneel-cyber/Clone-Proof` | 13 | 13 | **100%** |
| `typestack/class-validator` | 13 | 13 | **100%** |
| `motdotla/dotenv` | 13 | 13 | **100%** |
| All real-repository cases | 39 | 39 | **100%** |

There were no missed planted bugs after applying the documented adaptations. The control mutation produced no new finding for all three real repositories and in the offline suite, so it did not add a false positive.

## Runs 1–2 results (earlier code; superseded by Run 3)

The first check for every repository was run from the pre-run plan above. For repositories whose check was not blocked, both verification modes were exercised. The first-run columns below preserve those original observations; the added rerun columns describe the post-fix runs. Durations are wall-clock milliseconds measured around each CLI invocation. A verdict is assigned once per repository per run from the fixed set `correct`, `false fail`, `false block`, `environment-limited failure`, or `tool error`.

### Test-workflow evidence

The original “latest Actions run” notes were gathered from whichever workflow appeared first, not necessarily the workflow that runs the repository tests. For review, the following actual test workflows were identified from `.github/workflows` and their latest default-branch result was checked through the GitHub Actions API. These results are evidence about the repositories, not extra CloneProof runs.

| Repository | Test workflow page | Latest default-branch result |
|---|---|---|
| `tj/commander.js` | [tests.yml](https://github.com/tj/commander.js/actions/workflows/tests.yml) (`build`) | `success`, run `26628865091`, head `ba6d13ddb424`; test workflow includes `npm ci`, `npm test`, and `npm run check`. |
| `motdotla/dotenv` | [ci.yml](https://github.com/motdotla/dotenv/actions/workflows/ci.yml) (`CI`) | `success`, run `38966207868`, head `6d6e6c58074a`; workflow runs `npm ci` and `npm test`. |
| `axios/axios` | [ci.yml](https://github.com/axios/axios/actions/workflows/ci.yml) (`CI`) | `success`, run `21181650970`, head `ab06109b40e1`; default branch is `v1.x`, and the workflow runs the repository test jobs including browser setup. |
| `kelektiv/node.bcrypt.js` | [ci.yaml](https://github.com/kelektiv/node.bcrypt.js/actions/workflows/ci.yaml) (`ci`) | `success`, run `24395251292`, head `24aa3c50a990`; workflow runs `npm ci` and `npm test` on Node 18/20/22. |
| `typestack/class-validator` | [continuous-integration-workflow.yml](https://github.com/typestack/class-validator/actions/workflows/continuous-integration-workflow.yml) (`CI`) | `success`, run `22432165457`, head `2e1a5c27dbd6`; default branch is `develop` and the workflow runs the test job. |

| # | Repository | Commit | Expected | Check result | Verify no network | Verify network allowed | Duration ms (check / no-net / net) | Verdict | Notes / fixing commit | Rerun result | Rerun verdict |
|---:|---|---|---|---|---|---|---:|---|---|---|---|
| 1 | `psuvraneel-cyber/Clone-Proof` | `2fcd8d15a4cd` | Check and verify pass | `passed`, exit 0 | `passed`, exit 0 | `passed`, exit 0 | 2703 / 5373 / 4763 | correct | Control repository; the first no-network attempt found the image absent, then the exact digest was pulled. | Check `passed`; both verifies `passed` with `DOCKER_VERIFICATION_PASSED`. | correct |
| 2 | `tj/commander.js` | `ba6d13ddb424` | Check pass; network verify pass | `passed_with_warnings`, exit 0; `ENV_EXAMPLE_MISSING` | `blocked`, exit 2; `DOCKER_NETWORK_REQUIRED` | `failed`, exit 1; `DOCKER_VERIFICATION_FAILED` in test phase | 4756 / 3075 / 17773 | false fail | **Corrected in review:** Windows checked Git symlinks out as plain files, so CloneProof blamed the repository. The test workflow passes; fix `cf02646` now reads Git mode `120000`. | Check `passed_with_warnings`; no-network `blocked` by `DOCKER_NETWORK_REQUIRED`; network `blocked` by `DOCKER_SYMLINKS_BLOCKED` for 3 paths. | correct |
| 3 | `motdotla/dotenv` | `6d6e6c58074a` | Check pass; network verify pass | `passed_with_warnings`, exit 0; `ENV_EXAMPLE_MISSING` | `blocked`, exit 2; `DOCKER_NETWORK_REQUIRED` | `failed`, exit 1; `DOCKER_VERIFICATION_FAILED` in test phase | 2579 / 2292 / 45471 | false fail | **Corrected in review:** committed `tests/.env*` fixtures were omitted although a GitHub clone already made them public. The test workflow passes; fix `22e0258` stages fresh-clone sensitive files. | Check `passed_with_warnings`; network `passed_with_warnings` with `DOCKER_VERIFICATION_PASSED` and no omitted sensitive paths. | correct |
| 4 | `typestack/class-validator` | `2e1a5c27dbd6` | Check pass; network verify pass | `passed`, exit 0 | `blocked`, exit 2; `DOCKER_NETWORK_REQUIRED` | `passed`, exit 0 | 2340 / 2150 / 62479 | correct | TypeScript/Jest repository completed inside the controlled container. | Not rerun; first-run result remains valid. | correct |
| 5 | `expressjs/express` | `a419aa735038` | `LOCKFILE_MISSING`; verify blocked | `passed_with_warnings`, exit 0; `LOCKFILE_MISSING` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | 5150 / 2783 / 3465 | correct | No root lockfile, so CloneProof never starts Docker. | Not rerun; first-run result remains valid. | correct |
| 6 | `sindresorhus/slugify` | `3b17b2e84b97` | `LOCKFILE_MISSING`; verify blocked | `passed_with_warnings`, exit 0; `LOCKFILE_MISSING` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | 2283 / 1842 / 2168 | correct | Small npm package with no committed lockfile. | Not rerun; first-run result remains valid. | correct |
| 7 | `typeorm/typeorm` | `fe9239428751` | TypeScript/external-service case; npm-only verify blocked | `passed`, exit 0; pnpm metadata and nested packages | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | 6002 / 5175 / 5433 | correct | The npm-only profile blocked pnpm before attempting external database work. | Not rerun; first-run result remains valid. | correct |
| 8 | `kelektiv/node.bcrypt.js` | `24aa3c50a990` | Check pass; native install cannot pass with scripts skipped | `passed_with_warnings`, exit 0; `INSTALL_SCRIPTS_SKIPPED` | `blocked`, exit 2; `DOCKER_NETWORK_REQUIRED` | `failed`, exit 1; test phase | 2808 / 2560 / 13016 | environment-limited failure | **Corrected in review:** native installation is unavailable when lifecycle scripts are intentionally skipped, while the repository’s CI test workflow passes. | Check `passed` with `INSTALL_SCRIPTS_SKIPPED:skipped`; network `failed`, test phase, with the skipped-install-script explanation. | environment-limited failure |
| 9 | `axios/axios` | `326843a3902d` | Check pass; browser-dependent verify cannot pass | `passed_with_warnings`, exit 0 initially; `ENV_EXAMPLE_MISSING` | `blocked`, exit 2; `DOCKER_NETWORK_REQUIRED` | `failed`, exit 1; test phase | 9100 / 3799 / 74902 | environment-limited failure | **Corrected in review:** browser and committed TLS fixtures made this an environment-limited failure; the repository’s CI workflow passes. | Check `passed_with_warnings` with `INSTALL_SCRIPTS_SKIPPED` and `BROWSER_TESTS_DETECTED`; network `failed` in test phase with browser explanation, and TLS-fixture failures are gone (`omittedPaths: []`). | environment-limited failure |
| 10 | `vuejs/core` | `bf5f0dd8773d` | pnpm repository; npm-only verify blocked | `passed_with_warnings`, exit 0; nested packages, env/runtime warnings | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | 3016 / 2715 / 4333 | correct | `packageManager` is pnpm and the root preinstall rejects npm. | Not rerun; first-run result remains valid. | correct |
| 11 | `facebook/react` | `—` | Yarn repository; watch whether size blocks first | `blocked`, exit 2; `GITHUB_REPOSITORY_TOO_LARGE` | not run | not run | 973 / — / — | false block | **Corrected in review:** GitHub reported `1,119,361 KiB` for the full history, not the shallow checkout; the former sanity bound blocked a repository fitting CloneProof’s limits. | Check `passed_with_warnings`; shallow checkout metadata was **7,260 files / 41,784,802 bytes (~39.85 MiB)**, while the scanner completed and discovered 7,260 files. Both verifies `blocked` by `DOCKER_PREREQUISITES_FAILED` because the repository uses Yarn. Fix `a8d1dc1`. | correct |
| 12 | `jestjs/jest` | `61050e9323e7` | Yarn Berry; npm-only verify blocked | `passed_with_warnings`, exit 0; nested packages and env warning | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | `blocked`, exit 2; `DOCKER_PREREQUISITES_FAILED` | 14706 / 12391 / 10691 | correct | `.yarn/` was skipped; Yarn 4 package metadata caused the npm-only prerequisite block. | Not rerun; first-run result remains valid. | correct |
| 13 | `npm/cli` | `—` | Clear checkout-limit block | `blocked`, exit 2; `GITHUB_CHECKOUT_LIMIT_EXCEEDED` | not run | not run | 21014 / — / — | correct | Public preflight passed, then the shallow checkout exceeded CloneProof’s bounded checkout limits. | Not rerun; first-run result remains valid. | correct |
| 14 | `torvalds/linux` | `—` | Far-too-large repository blocked before clone | `blocked`, exit 2; `GITHUB_REPOSITORY_TOO_LARGE` | not run | not run | 678 / — / — | correct | GitHub reported 6,403,300 KiB; this check was run only while the preflight size check was available. | Check `blocked`, exit 2, `GITHUB_REPOSITORY_TOO_LARGE`; no clone; `target.preflight: checked`. | correct |
| 15 | `pallets/flask` | `d086db856be1` | Python root blocked | `blocked`, exit 2; `UNSUPPORTED_ROOT` | not run | not run | 2485 / — / — | correct | Python marker was identified before any dynamic verification. | Not rerun; first-run result remains valid. | correct |

### Rerun evidence

Each row below is one post-fix CLI invocation. `target.commit` is the commit reported by the shallow clone; `—` means the run was blocked before a checkout existed. The duration is the measured wall-clock time for that invocation.

| Repository | Mode | Status / exit | Main finding codes | `target.commit` | `target.preflight` | Duration ms |
|---|---|---|---|---|---|---:|
| `psuvraneel-cyber/Clone-Proof` | check | `passed` / 0 | `NESTED_PACKAGES_SKIPPED` | `f8af7fc55b515c053df0ce7307808d71144a4aa0` | `checked` | 2165 |
| `psuvraneel-cyber/Clone-Proof` | verify, no network | `passed` / 0 | `DOCKER_VERIFICATION_PASSED` | `f8af7fc55b515c053df0ce7307808d71144a4aa0` | `checked` | 5198 |
| `psuvraneel-cyber/Clone-Proof` | verify, network | `passed` / 0 | `DOCKER_VERIFICATION_PASSED` | `f8af7fc55b515c053df0ce7307808d71144a4aa0` | `checked` | 4358 |
| `facebook/react` | check | `passed_with_warnings` / 0 | `ENV_EXAMPLE_MISSING` | `098d2e87a1f7142947418d15f63f975b58c4685b` | `checked` | 10632 |
| `facebook/react` | verify, no network | `blocked` / 2 | `DOCKER_PREREQUISITES_FAILED` | `098d2e87a1f7142947418d15f63f975b58c4685b` | `checked` | 8860 |
| `facebook/react` | verify, network | `blocked` / 2 | `DOCKER_PREREQUISITES_FAILED` | `098d2e87a1f7142947418d15f63f975b58c4685b` | `checked` | 8016 |
| `tj/commander.js` | check | `passed_with_warnings` / 0 | `ENV_EXAMPLE_MISSING` | `ba6d13ddb4243e5913367734f8c159089ffe7834` | `checked` | 3663 |
| `tj/commander.js` | verify, no network | `blocked` / 2 | `DOCKER_NETWORK_REQUIRED` | `ba6d13ddb4243e5913367734f8c159089ffe7834` | `checked` | 2572 |
| `tj/commander.js` | verify, network | `blocked` / 2 | `DOCKER_SYMLINKS_BLOCKED` | `ba6d13ddb4243e5913367734f8c159089ffe7834` | `checked` | 2675 |
| `motdotla/dotenv` | check | `passed_with_warnings` / 0 | `INSTALL_SCRIPTS_SKIPPED`, `ENV_EXAMPLE_MISSING` | `6d6e6c58074adc12131ec6ab6eac92fb92484dbc` | `checked` | 2055 |
| `motdotla/dotenv` | verify, network | `passed_with_warnings` / 0 | `DOCKER_VERIFICATION_PASSED`, `INSTALL_SCRIPTS_SKIPPED` | `6d6e6c58074adc12131ec6ab6eac92fb92484dbc` | `checked` | 44882 |
| `axios/axios` | check | `passed_with_warnings` / 0 | `INSTALL_SCRIPTS_SKIPPED`, `BROWSER_TESTS_DETECTED`, `ENV_EXAMPLE_MISSING` | `326843a3902d73c9f6af9bad7b55e2412566a251` | `checked` | 4884 |
| `axios/axios` | verify, network | `failed` / 1 | `DOCKER_VERIFICATION_FAILED`, `INSTALL_SCRIPTS_SKIPPED`, `BROWSER_TESTS_DETECTED` | `326843a3902d73c9f6af9bad7b55e2412566a251` | `checked` | 221327 |
| `kelektiv/node.bcrypt.js` | check | `passed` / 0 | `INSTALL_SCRIPTS_SKIPPED` | `24aa3c50a990db8cea4f545cd21b8740ea0364ea` | `checked` | 1941 |
| `kelektiv/node.bcrypt.js` | verify, network | `failed` / 1 | `DOCKER_VERIFICATION_FAILED`, `INSTALL_SCRIPTS_SKIPPED` | `24aa3c50a990db8cea4f545cd21b8740ea0364ea` | `checked` | 10140 |
| `torvalds/linux` | check | `blocked` / 2 | `GITHUB_REPOSITORY_TOO_LARGE` | `—` | `checked` | 564 |

### Summary

Counting rule: each of the 15 table rows contributes exactly one verdict to the first-run count and exactly one verdict to the after-fixes count. A repository is not counted once per command; `check` and the two verify modes together determine that row's single run verdict. The categories are mutually exclusive and sum to 15.

| Run | correct | false fail | false block | environment-limited failure | tool error | Total |
|---|---:|---:|---:|---:|---:|---:|
| First run | 10 | 2 | 1 | 2 | 0 | 15 |
| After fixes | 13 | 0 | 0 | 2 | 0 | 15 |

- The corrected first-run false failures are Commander’s Windows symlink materialization and dotenv’s committed fixture omission. The corrected first-run false block is React’s use of GitHub’s whole-history size against the former sanity bound.
- The two after-fix environment-limited failures are bcrypt’s native build and Axios’s browser-dependent test phase. Better diagnostics make the limitation honest but do not change that verdict.
- Four fixes were implemented with offline regression tests: `a8d1dc1` (4 GiB full-history sanity limit), `cf02646` (Git-listed symlinks), `22e0258` (fresh-clone sensitive files), and `aeea9ac` (informational skipped-install-script finding). The earlier diagnostic commits `cb44146` and `8ca4fc3` remain in history and are covered by the final suite.
- At the time of the four-fix rerun, the host suite was **130 tests: 129 passed, 1 skipped** (the expected Windows symlink `EPERM` case). That historical count predates later implementation and regression tests; the current host count is recorded in `docs/HANDOFF.md`. The Linux container suite is reported separately in the handoff checks.
- The final cleanup audit found no `cloneproof-github-*` temporary folders and no containers from `docker ps -a --filter name=cloneproof-verify`.

## Target-guard-fixes check-only recheck

A check-only recheck on the target-guard-fixes branch was made before that branch was merged with the precision fixes, so its results are superseded by Run 3 below.

## Run 3: final precision-fixes code (2026-10-17, commit `54141a5`)

Run 3 was measured after all Part 1 precision fixes and after the final pinned Docker image was prepared. Expectations were retained from the pre-run plan above before the commands were started. All 15 `check` commands ran against the public URLs. Every non-blocked check also received `verify --docker --execute` with and without `--allow-network`; `npm-cli`, Linux, and Flask were blocked by check and therefore had no verify invocation. `target.preflightReason` was recorded for every GitHub check. No target repository code ran on the host.

| Repository | Expected check / verdict | Check | Verify no network | Verify network | Commit / preflightReason | Duration ms | Verdict |
|---|---|---|---|---|---|---:|---|
| `psuvraneel-cyber/Clone-Proof` | pass / correct | `passed` / 0 | `passed` / 0 | `passed` / 0 | `630015c804a3f67f868a724fb1dd3d5527394c8a` / `checked` | 2485 / 5830 / 5092 | correct |
| `tj/commander.js` | pass; Docker network/symlink limits / correct | `passed` / 0 | `blocked` / 2 `DOCKER_NETWORK_REQUIRED` | `blocked` / 2 `DOCKER_SYMLINKS_BLOCKED` | `ba6d13ddb4243e5913367734f8c159089ffe7834` / `checked` | 5399 / 3357 / 3681 | correct |
| `motdotla/dotenv` | pass with advisory findings / correct | `passed_with_warnings` / 0 `ENV_EXAMPLE_MISSING` | `blocked` / 2 `DOCKER_NETWORK_REQUIRED` | `passed_with_warnings` / 0 | `6d6e6c58074adc12131ec6ab6eac92fb92484dbc` / `checked` | 2515 / 2118 / 50442 | correct |
| `typestack/class-validator` | pass; network verify pass / correct | `passed` / 0 | `blocked` / 2 `DOCKER_NETWORK_REQUIRED` | `passed` / 0 | `2e1a5c27dbd65b80e27fe96b49bd6e6641fa3603` / `checked` | 2317 / 2759 / 67849 | correct |
| `expressjs/express` | pass with `LOCKFILE_MISSING` / correct | `passed_with_warnings` / 0 `LOCKFILE_MISSING` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `a419aa7350389a275ab45fde2e849ed1f02449ef` / `checked` | 5628 / 3363 / 2426 | correct |
| `sindresorhus/slugify` | pass with `LOCKFILE_MISSING` / correct | `passed_with_warnings` / 0 `LOCKFILE_MISSING` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `3b17b2e84b97624a683aafaa38184bf2746fab22` / `checked` | 2093 / 1847 / 1526 | correct |
| `typeorm/typeorm` | pass; npm-only profile blocked / correct | `passed` / 0 `SERVICES_LIKELY_REQUIRED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `fe92394287516feeada6e9c308ebe22deca2458e` / `checked` | 17718 / 8390 / 6577 | correct |
| `kelektiv/node.bcrypt.js` | pass; native test limitation / environment-limited failure | `passed` / 0 | `blocked` / 2 `DOCKER_NETWORK_REQUIRED` | `failed` / 1 `DOCKER_VERIFICATION_FAILED` | `24aa3c50a990db8cea4f545cd21b8740ea0364ea` / `checked` | 2205 / 1965 / 10787 | environment-limited failure |
| `axios/axios` | pass with browser advisory / environment-limited failure | `passed_with_warnings` / 0 `BROWSER_TESTS_DETECTED` | `blocked` / 2 `DOCKER_NETWORK_REQUIRED` | `failed` / 1 `DOCKER_VERIFICATION_FAILED` | `326843a3902d73c9f6af9bad7b55e2412566a251` / `checked` | 8426 / 4179 / 223606 | environment-limited failure |
| `vuejs/core` | pass; npm-only profile blocked / correct | `passed_with_warnings` / 0 `BROWSER_TESTS_DETECTED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `bf5f0dd877dd3c23ce85c2cbc1dd771567e84c8c` / `checked` | 3278 / 3296 / 2485 | correct |
| `facebook/react` | pass; Yarn profile blocked / correct | `passed` / 0 | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `098d2e87a1f7142947418d15f63f975b58c4685b` / `checked` | 18416 / 9576 / 8781 | correct |
| `jestjs/jest` | pass; Yarn profile blocked / correct | `passed` / 0 | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `blocked` / 2 `DOCKER_PREREQUISITES_FAILED` | `61050e9323e742539dc2360236671110e37329e6` / `checked` | 11028 / 7909 / 12961 | correct |
| `npm/cli` | bounded checkout block / correct | `blocked` / 2 `GITHUB_CHECKOUT_LIMIT_EXCEEDED` | not run | not run | no commit / `checked` | 22148 | correct |
| `torvalds/linux` | full-history size block / correct | `blocked` / 2 `GITHUB_REPOSITORY_TOO_LARGE` | not run | not run | no commit / `checked` | 578 | correct |
| `pallets/flask` | unsupported Python root / correct | `blocked` / 2 `UNSUPPORTED_ROOT` | not run | not run | `d086db856be187255b8ec61ef409357393020f32` / `checked` | 2157 | correct |

Run 3 therefore totals **13 correct** and **2 environment-limited failures**, with all 15 repositories represented exactly once in the verdict count.

### Run 3 warning and failure precision

The following table uses only the Run 3 `check` reports. Skipped/info findings are excluded; every warning or failed finding is listed once.

| Repository | Finding | Status | Judgment | Reason |
|---|---|---|---|---|
| `motdotla/dotenv` | `ENV_EXAMPLE_MISSING` | warning | noise | Optional dotenv configuration keys are not required to install or run the package workflow. |
| `expressjs/express` | `LOCKFILE_MISSING` | warning | real | A fresh clone cannot reproduce dependency versions without a committed root lockfile. |
| `sindresorhus/slugify` | `LOCKFILE_MISSING` | warning | real | A fresh clone cannot reproduce dependency versions without a committed root lockfile. |
| `axios/axios` | `BROWSER_TESTS_DETECTED` | warning | real | The controlled Node image has no browser executable, so browser-reachable tests are a real verification limitation. |
| `vuejs/core` | `BROWSER_TESTS_DETECTED` | warning | real | The controlled Node image has no browser executable for the detected workflow. |
| `pallets/flask` | `UNSUPPORTED_ROOT` | warning | real | The target is a Python repository outside CloneProof's supported Node/TypeScript execution profile. |

| Category | Real | All | Precision |
|---|---:|---:|---:|
| Warnings | 5 | 6 | **83.3%** |
| Failed findings | 0 | 0 | **not applicable** |
| Combined warnings + failed findings | 5 | 6 | **83.3%** |

The earlier 28.6% and 66.7% values were measured with a different check set and are not used for Run 3 precision.

### Run 3 planted-bug rerun

`node scripts/planted-bugs-real.js` performs read-only shallow clones, mutates copies, runs only `node src/cli.js check`, and deletes every temporary copy. The final run used commit `54141a5` and detected every mutation in all three repositories. The whitespace-only README mutation is the control and produced no new finding.

| Repository | Detected | Total | Rate |
|---|---:|---:|---:|
| `psuvraneel-cyber/Clone-Proof` | 13 | 13 | 100% |
| `typestack/class-validator` | 13 | 13 | 100% |
| `motdotla/dotenv` | 13 | 13 | 100% |
| All real-repository cases | **39** | **39** | **100%** |

The repeatable procedure is committed as `scripts/planted-bugs-real.js`; it does not install dependencies, run target scripts, run target tests, or start target Dockerfiles. The offline suite remains 13/13.

### Temporary-folder measurement

On the Windows host, all existing `cloneproof-*` directories were removed before the measurement. The directory count was **0 before** and **0 after** ten exact `npm test` repetitions; **0 new directories** were created. Every run exited `0`. The cleanup-failure regression test now removes its intentionally retained fixture in a `finally` block, so repeated test runs do not leave clone directories behind.

## Run 4: final review rechecks (expected before execution)

The following expectations were written before any Run 4 command was started. The target repository commands use the local CloneProof implementation at the review baseline that will be recorded in the actual-results table below.

| Command | Expected result |
|---|---|
| `node src/cli.js verify https://github.com/uuidjs/uuid --docker --execute --allow-network` | `failed`, exit `1`; `VERIFY_NO_TESTS_RAN` evidence contains `# tests 0`; `GIT_METADATA_REQUIRED` is `warning` and mentions `.git`. |
| `node src/cli.js verify https://github.com/typestack/class-validator --docker --execute --allow-network` | `passed`, exit `0`; bounded output reports 806 tests. |
| `node src/cli.js check https://github.com/typicode/json-server` | `passed`, exit `0`; no `ENV_EXAMPLE_MISSING`. |
| `node src/cli.js check https://github.com/tj/commander.js --no-color` | `passed`, exit `0`; exactly one `Findings:` line and one `Finding counts:` line. |
| `node src/cli.js check examples/broken-node` | `failed`, exit `1`. |
| `node src/cli.js check https://github.com/colinhacks/zod` | exit `0`; includes `PACKAGE_MANAGER_UNRECOGNIZED`. |
| `node src/cli.js check https://github.com/date-fns/date-fns` | exit `0`; includes `MONOREPO_ROOT_TEST_SCRIPT_MISSING`. |
| `node src/cli.js check https://github.com/sindresorhus/got` and `node src/cli.js check https://github.com/honojs/hono` | exit `0`; neither reports `ENV_EXAMPLE_MISSING`. |
| Two `node src/cli.js check <repository> --format json --output <file>` runs for each of express, nest, commander.js, axios, json-server, ms, clsx, ky, trpc, and zod | both runs exit `0` and the resulting JSON bytes are identical for each repository. |

### Run 4 actual results

The commands were run against local CloneProof commit `ef8056d` (`test: cover Git metadata verification warnings`), before the later CI-fix pass. This table records the actual status, exit code, reported target commit where available, and wall-clock duration for every direct recheck. The JSON-repeat rows also record the byte-identity result.

| Command / target | Actual result | Target commit | Exit | Duration | Notes |
|---|---|---|---:|---:|---|
| `uuidjs/uuid` verify | `failed`; `VERIFY_NO_TESTS_RAN` evidence `Matched zero-test line: # tests 0`; `GIT_METADATA_REQUIRED` warning mentions `.git` | `3b70ec29ef9067be33384a16dcd48dc77a0efdf4` | 1 | 21507 | Container exit code remained 0; `verification.noTestsRan: true`; `failedPhase` was not `test`. |
| `typestack/class-validator` verify | `passed`; output reported `Tests: 806 passed, 806 total` | `2e1a5c27dbd65b80e27fe96b49bd6e6641fa3603` | 0 | 63018 | — |
| `typicode/json-server` check | `passed`; no `ENV_EXAMPLE_MISSING` | `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea` | 0 | 2073 | — |
| `tj/commander.js` check | `passed`; one `Findings:` line and one `Finding counts:` line; no ANSI output | `ba6d13ddb4243e5913367734f8c159089ffe7834` | 0 | 4508 | — |
| `examples/broken-node` check | `failed` | local | 1 | 119 | — |
| `colinhacks/zod` check | `passed_with_warnings`; `PACKAGE_MANAGER_UNRECOGNIZED` | `afdac65e0f80c0ccf9e8909da97c411567908b57` | 0 | 3955 | — |
| `date-fns/date-fns` check | `passed_with_warnings`; `MONOREPO_ROOT_TEST_SCRIPT_MISSING` | `717ce0a807ea4c6b540d015b5c408723175b2838` | 0 | 4107 | — |
| `sindresorhus/got` check | `passed_with_warnings`; no `ENV_EXAMPLE_MISSING` | `05b4476913da39a47dd8e20d29e250f28b0a6dca` | 0 | 2368 | `LOCKFILE_MISSING` was the warning. |
| `honojs/hono` check | `passed`; no `ENV_EXAMPLE_MISSING` | `5ca49b0720755c585c9a9835f0a479ceea36fb52` | 0 | 2821 | — |
| JSON repeat: express | both `passed_with_warnings`; byte-identical | `0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8` | 0 / 0 | 8236 | — |
| JSON repeat: nest | both `passed`; byte-identical | `284ca7d54f97ac87308cd3c5c1a669f4f8b3ecec` | 0 / 0 | 8279 | — |
| JSON repeat: commander.js | both `passed`; byte-identical | `ba6d13ddb4243e5913367734f8c159089ffe7834` | 0 / 0 | 5618 | — |
| JSON repeat: axios | both `passed_with_warnings`; byte-identical | `7d15df3f4cff1be2f1ed397f98170aadef399071` | 0 / 0 | 9717 | — |
| JSON repeat: json-server | both `passed`; byte-identical | `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea` | 0 / 0 | 3793 | — |
| JSON repeat: ms | both `passed`; byte-identical | `4ff48cec099f0514c3e9bbca18706c9c21122bfb` | 0 / 0 | 3879 | — |
| JSON repeat: clsx | both `passed_with_warnings`; byte-identical | `925494cf31bcd97d3337aacd34e659e80cae7fe2` | 0 / 0 | 7181 | — |
| JSON repeat: ky | both `passed_with_warnings`; byte-identical | `3541888878c4d303a8bc2ad61815f4e048f55a5d` | 0 / 0 | 4619 | — |
| JSON repeat: trpc | both `passed`; byte-identical | `1c9bf51ea572fd46fa52fb725999b8d0c6950386` | 0 / 0 | 6844 | — |
| JSON repeat: zod | both `passed_with_warnings`; byte-identical | `afdac65e0f80c0ccf9e8909da97c411567908b57` | 0 / 0 | 6377 | — |

### Run 4 regression follow-up (2026-10-20)

Run 4's target results above remain valid historical measurements from `ef8056d`; the following fixes address the separate CI regressions reported by Actions run `39434993722` and do not rewrite those target verdicts:

- The npm package-content assertion failed because its hard-coded source list omitted `src/util/cleanup-supervisor.js`. Commit `3393290` now derives the expected source list from sorted `git ls-files src`, normalizes separators, and keeps exact equality against `npm pack --dry-run --json`.
- The healthy fixture exposed a false zero-test result because top-level `node:test` output includes `# suites 0`/`ℹ suites 0`. Commit `040ff96` removes suite-count-only triggers, vetoes detection when any positive test evidence is present, and adds a real child-process regression using `examples/healthy-node`.
- A first local verifier image inspect can transiently miss an existing image while Docker Desktop wakes from Resource Saver. Commit `fef9119` waits two seconds and retries exactly once without pulling; injected tests cover both recovery and persistent failure.
- The post-fix `npm test` count was 232 tests (231 passed, 0 failed, 1 expected Windows symlink `EPERM` skip). The replacement CI receipt is main run `39446244932` for the PR #1 merge `bdef68f`, which passed; no separate Docker/network recheck for this follow-up is recorded.

## Run 5: random sample, pre-registered (2026-10-30)

Runs 1–4 used hand-picked, well-known repositories, and no blocking (exit `1`) finding fired in any of them, so the accuracy of the findings that fail a build was never measured. Run 5 uses a seeded random sample, and the judging rules below were committed before any CloneProof command ran against it.

### Sampling frame

- **Population:** public, non-fork, non-archived GitHub repositories whose primary language is JavaScript or TypeScript, created between 2014-01-01 and 2025-10-29, with at least 10 stars, pushed on or after 2025-10-30, and with a root `package.json` on the default branch.
- **Draw:** `node scripts/fieldtest.js sample --seed 20261030 --count 50 --out docs/field-test/run5-sample.json`. Each draw picks a language and a creation day uniformly at random, runs the GitHub search `language:<language> created:<day> stars:>=10 pushed:>=2025-10-30 fork:false archived:false is:public`, and takes a uniformly random result among the first 1,000. Days with no results, duplicates, and repositories without a root `package.json` are recorded as rejected draws and redrawn.
- **Known biases:** sampling is uniform over creation days, not over repositories, so repositories created on quiet days are over-represented; GitHub search caps each query at 1,000 results; the 10-star floor and the 12-month activity window exclude abandoned and very small projects. The result describes this frame, not all Node.js repositories.
- **Pre-run facts:** for every sampled repository, the sampler records the default-branch head commit, root lockfiles, the `scripts.test` kind, `packageManager`, workspaces, and `private`, read through the GitHub API. No repository is cloned or executed while sampling.

### Sample

Drawn on 2026-10-30 with seed `20261030`. Draws: 62 (accepted 50, empty 2, rejected: no-root-package-json 10).

| # | Repository | Head commit | Language | Stars | Root lockfiles | `scripts.test` | `packageManager` | Expected findings |
|---:|---|---|---|---:|---|---|---|---|
| 1 | `mfuu/vue3-virtual-sortable` | `60cc9f4cc057` | TypeScript | 59 | none | missing | — | `LOCKFILE_MISSING`, `TEST_SCRIPT_MISSING` |
| 2 | `wardellbagby/lyricistant` | `12508c9d21b9` | TypeScript | 74 | `package-lock.json` | missing | `npm@11.3.0` | `TEST_SCRIPT_MISSING` |
| 3 | `knowankit/trello-clone` | `19e9d64a4211` | TypeScript | 357 | `yarn.lock` | missing | — | `TEST_SCRIPT_MISSING` |
| 4 | `tidepool-org/uploader` | `4c44f03d670a` | JavaScript | 128 | `yarn.lock` | present | `yarn@3.6.4` | none |
| 5 | `os-climate/physrisk-ui` | `d285d03b0cfd` | JavaScript | 10 | `package-lock.json` | present | — | none |
| 6 | `snowcoders/sortier` | `9ab4d0bec05e` | TypeScript | 31 | `package-lock.json` | present (workspaces) | — | none |
| 7 | `XFox111/TabsAsideExtension` | `0829b24c81b1` | TypeScript | 180 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 8 | `eemeli/yaml` | `528ef30d6ded` | TypeScript | 1702 | `package-lock.json` | present | — | none |
| 9 | `biud436/InitialEditor` | `8d84e1ea21d2` | TypeScript | 12 | `yarn.lock` | present (workspaces) | `yarn@4.3.1` | none |
| 10 | `uphold/uphold-sdk-javascript` | `a282ae571bfa` | JavaScript | 89 | `yarn.lock` | present | `yarn@4.12.0` | none |
| 11 | `XiaoLuoTian189/LanQiao` | `3dd0b6b60fee` | JavaScript | 38 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 12 | `Unibeautify/vscode` | `faa42041a32f` | TypeScript | 118 | `package-lock.json` | present | — | none |
| 13 | `stackblitz/starters` | `bfcd719483e7` | TypeScript | 152 | `package-lock.json` | present | — | none |
| 14 | `jembi/openhim-core-js` | `b62a2e4dbdc6` | JavaScript | 95 | `package-lock.json` | present | — | none |
| 15 | `TomPlum/learn-japanese` | `ec06e2ac96df` | TypeScript | 17 | `package-lock.json` | present | — | none |
| 16 | `peterKaleta/react-token-autocomplete` | `72b0c5aa66c8` | TypeScript | 104 | `package-lock.json` | present | — | none |
| 17 | `eemeli/make-plural` | `819a748c47be` | JavaScript | 71 | `package-lock.json` | present (workspaces) | — | none |
| 18 | `artus9033/chartjs-plugin-dragdata` | `dc96befa732c` | TypeScript | 276 | `package-lock.json` | present | — | none |
| 19 | `Pithaya/spicetify-apps` | `9a7da4e7c34d` | TypeScript | 96 | `package-lock.json` | missing (workspaces) | — | `MONOREPO_ROOT_TEST_SCRIPT_MISSING` |
| 20 | `vuejs/repl` | `9b5bc873415b` | TypeScript | 1098 | `pnpm-lock.yaml` | missing | `pnpm@10.14.0` | `TEST_SCRIPT_MISSING` |
| 21 | `FluffyBubu/cypress-sandbox` | `1bdacb9fc876` | JavaScript | 22 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 22 | `meikidd/iso-639-1` | `403255b1a0d6` | JavaScript | 221 | `package-lock.json` | present | — | none |
| 23 | `DanWahlin/Observable-Store` | `a2066a183cc0` | TypeScript | 631 | none | present | — | `LOCKFILE_MISSING` |
| 24 | `vechain/connex` | `2c9193257389` | TypeScript | 84 | `package-lock.json` | present | — | none |
| 25 | `ruanqizhen/python_book` | `bfca0141ec76` | JavaScript | 27 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 26 | `hmara-info/language-settings-manager` | `c7ae8399045b` | JavaScript | 23 | `package-lock.json` | present | — | none |
| 27 | `braiekhazem/react-kanban-kit` | `8a6aeaeb2c16` | TypeScript | 99 | `package-lock.json` | present | — | none |
| 28 | `MIDA-group/CytoBrowser` | `8bacc6497ff5` | JavaScript | 22 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 29 | `taiga-family/ng-morph` | `6611356a76a9` | TypeScript | 158 | `package-lock.json` | present (workspaces) | — | none |
| 30 | `gabrielbs/react-placeholder-loading` | `e03e7ab53616` | TypeScript | 13 | `yarn.lock` | present | — | none |
| 31 | `nextcloud/cdav-library` | `8f2dbccf9d76` | JavaScript | 74 | `package-lock.json` | present | — | none |
| 32 | `tobysmith568/read-receipt` | `389c4a519811` | TypeScript | 16 | `bun.lock` | present | — | none |
| 33 | `ChristopherChudzicki/math3d-next` | `464506c8387d` | TypeScript | 10 | `yarn.lock` | present (workspaces) | `yarn@4.8.1` | none |
| 34 | `josin/kusto-syntax-highlighting` | `83c54cfe67ed` | TypeScript | 13 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 35 | `glacier-studio/CoCo-Source-Code-Plan` | `91c9b89ea975` | JavaScript | 10 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 36 | `digitalmediabremen/hej` | `474e6734f881` | JavaScript | 11 | none | present | — | `LOCKFILE_MISSING` |
| 37 | `projectwallace/css-code-quality` | `eb29e3045cdd` | TypeScript | 155 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@11.16.0` | none |
| 38 | `FiloSottile/typage` | `38b8b10cb224` | TypeScript | 496 | `package-lock.json` | present | — | none |
| 39 | `vtex-apps/checkout-ui-custom` | `287e0a027e72` | JavaScript | 25 | `yarn.lock` | missing | — | `TEST_SCRIPT_MISSING` |
| 40 | `sourcefuse/loopback4-soft-delete` | `eeb07e347767` | TypeScript | 40 | `package-lock.json` | present | — | none |
| 41 | `org-nexus-projects/ufabc-next` | `ae1a2d682f5e` | TypeScript | 73 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@10.33.2` | none |
| 42 | `UMAprotocol/protocol` | `c8c3f67367af` | JavaScript | 490 | `yarn.lock` | present (workspaces) | — | none |
| 43 | `MomenSherif/react-oauth` | `cbe0d2b5fe1a` | TypeScript | 1339 | `yarn.lock` | missing (workspaces) | `yarn@4.6.0` | `MONOREPO_ROOT_TEST_SCRIPT_MISSING` |
| 44 | `fraunhoferfokus/peer-dial` | `dea62c29884c` | JavaScript | 45 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 45 | `fedstack-org/aoi` | `a8ca8261e413` | TypeScript | 21 | `yarn.lock` | missing (workspaces) | `yarn@4.9.1` | `MONOREPO_ROOT_TEST_SCRIPT_MISSING` |
| 46 | `IRCraziestTaxi/typeorm-linq-repository` | `701cfaa16f52` | TypeScript | 185 | `package-lock.json` | present | — | none |
| 47 | `pixijs/pixi-react` | `30cf1f86a590` | TypeScript | 2888 | `package-lock.json` | present (workspaces) | — | none |
| 48 | `meowtec/imgo` | `9fe7450970dd` | TypeScript | 4458 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.0.0` | none |
| 49 | `2factorauth/twofactorauth` | `9b39477ccf25` | JavaScript | 3469 | none | present | — | `LOCKFILE_MISSING` |
| 50 | `NextJSTemplates/startup-nextjs` | `e730b6a99c77` | TypeScript | 1687 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |

### Pre-registered expectations

`expected` in `run5-sample.json` lists the findings predicted from those facts alone, by fixed rules in `scripts/fieldtest.js`:

1. Invalid `package.json` → `PACKAGE_JSON_INVALID` (nothing else predicted).
2. Missing or empty `scripts.test` → `TEST_SCRIPT_MISSING`, or `MONOREPO_ROOT_TEST_SCRIPT_MISSING` when workspaces are declared.
3. The npm placeholder test script (`no test specified`) → `TEST_SCRIPT_PLACEHOLDER`.
4. No root lockfile → `LOCKFILE_MISSING`.
5. A `packageManager` of npm, Yarn, pnpm, or Bun that differs from the manager of the only root lockfile kind → `PACKAGE_MANAGER_LOCKFILE_MISMATCH`.

`README_SCRIPT_UNKNOWN`, `LOCKFILE_OUT_OF_SYNC`, and environment findings are not predicted. Differences between predicted and observed findings are reported, not hidden.

### Procedure

`node scripts/fieldtest.js run --sample docs/field-test/run5-sample.json --out docs/field-test/run5-results.json` runs `node src/cli.js check <url> --format json` once per repository, static inspection only, with the unauthenticated GitHub preflight. No `verify` run is made. Reports are written to the ignored `reports/field/run5/` folder; the committed results keep each repository's status, exit code, commit, duration, and every `failed` and `warning` finding.

### Judging rules

Every `failed` and `warning` finding receives exactly one judgment, made by reading the repository at the checked commit:

- **real** — the finding is true and matters to someone setting up this repository root.
- **policy** — the finding is true, but describes a choice a reasonable maintainer may make on purpose. Whether such a finding should fail a build is a product decision, not an accuracy question.
- **false** — the finding's claim, read as a statement about setting up this repository root, is wrong.

Code-specific rules:

- `TEST_SCRIPT_MISSING` / `TEST_SCRIPT_PLACEHOLDER` / `MONOREPO_ROOT_TEST_SCRIPT_MISSING`: real if the repository contains test files or its README or CI asks contributors to run tests; policy if the repository has no tests at all; false if a working root test command exists.
- `README_SCRIPT_UNKNOWN` / `README_START_COMMAND_UNKNOWN`: real if the README tells someone working in this repository root to run the command; false if the command, read in context, is for a different project (a consumer's project, generated template output, an example, or a sub-package folder).
- `LOCKFILE_OUT_OF_SYNC` / `LOCKFILE_INVALID`: real if the root `package.json` and the lockfile disagree in a way that makes `npm ci` refuse to install; false otherwise.
- `LOCKFILE_MISSING`: policy if the package is published on npm under its `package.json` name (libraries often leave lockfiles out on purpose); real otherwise.
- `PACKAGE_MANAGER_LOCKFILE_MISMATCH` / `MULTIPLE_LOCKFILES`: real if the declared or committed package managers genuinely conflict for a fresh install; false otherwise.
- `ENV_EXAMPLE_MISSING` / `ENV_KEY_MISSING`: real if at least one listed key is needed to run the application or its tests and has no default; policy if every listed key is an optional setting; false if a listed key is not read by the repository's own code.
- Any other warning: real if the stated condition is true and affects setting up this root; policy if it is true but intentional; false if the stated condition is wrong.

Each judgment records a one-line reason. Reported metrics: **precision** = real ÷ total and **correctness** = (real + policy) ÷ total, separately for blocking (`failed`) and warning findings, with Wilson 95% intervals, plus the share of exit-`1` repositories justified by at least one real blocking finding.

Limitations of this design: one reviewer (Claude, an AI assistant working in this session) makes every judgment, and it is not blind to CloneProof's output. The recorded reasons and committed results let anyone re-judge the same findings.

### Run 5 results

The pre-registration was committed as `df0ee43` before the run. CloneProof's `src/` at that commit is identical to `main` at `32bf359`. All 50 checks ran on the Windows host on 2026-10-30 with `target.preflightReason: checked`. All 49 reported commits matched the head commits recorded at sampling time; the 50th clone failed, so it reported none. After the run, the script was renamed from `scripts/field-test.js` to `scripts/fieldtest.js` because `node --test` treats `*-test.js` files as tests; its logic did not change. Median duration was 2.7 s and the longest was 22 s. Raw results are in [`field-test/run5-results.json`](field-test/run5-results.json), and every judgment with its reason is in [`field-test/run5-judgments.json`](field-test/run5-judgments.json). Reproduce the tables with `node scripts/fieldtest.js summary --results docs/field-test/run5-results.json --judgments docs/field-test/run5-judgments.json --sample docs/field-test/run5-sample.json`.

| Report status | Repositories | Exit code |
|---|---:|---|
| `passed` | 17 | 0 |
| `passed_with_warnings` | 19 | 0 |
| `failed` | 13 | 1 |
| `incomplete` | 1 | 2 |

| Findings | Total | Real | Policy | False | Precision (real) | Correctness (real + policy) |
|---|---:|---:|---:|---:|---|---|
| Blocking (failed) | 14 | 4 | 10 | 0 | 4 / 14 = **28.6%** (95% Wilson CI 11.7%–54.6%) | 14 / 14 = **100.0%** (95% Wilson CI 78.5%–100.0%) |
| Warning | 26 | 8 | 5 | 13 | 8 / 26 = **30.8%** (95% cluster-bootstrap CI 14.3%–50.0%) | 13 / 26 = **50.0%** (95% cluster-bootstrap CI 31.3%–69.2%) |

Repositories with exit `1`: 13 of 50. Justified by at least one real blocking finding: 3 / 13 = **23.1%** (95% Wilson CI 8.2%–50.3%).

| Language | Repositories | Real / blocking | Real / warnings |
|---|---:|---:|---:|
| JavaScript | 18 | 2 / 6 | 3 / 10 |
| TypeScript | 32 | 2 / 8 | 5 / 16 |

| Code | Status | Total | Real | Policy | False |
|---|---|---:|---:|---:|---:|
| `GITHUB_CLONE_FAILED` | failed | 1 | 1 | 0 | 0 |
| `README_SCRIPT_UNKNOWN` | failed | 1 | 1 | 0 | 0 |
| `TEST_SCRIPT_MISSING` | failed | 12 | 2 | 10 | 0 |
| `BROWSER_TESTS_DETECTED` | warning | 8 | 3 | 0 | 5 |
| `ENV_EXAMPLE_MISSING` | warning | 8 | 0 | 1 | 7 |
| `LOCKFILE_MISSING` | warning | 4 | 3 | 1 | 0 |
| `MONOREPO_ROOT_TEST_SCRIPT_MISSING` | warning | 4 | 2 | 2 | 0 |
| `PRIVATE_REGISTRY` | warning | 1 | 0 | 0 | 1 |
| `RUNTIME_VERSION_MISMATCH` | warning | 1 | 0 | 1 | 0 |

**Statistical notes (added after review of PR #6).**

- *Intervals.* Each blocking finding came from a different repository, so those findings are independent sampled units and the Wilson interval applies. Three repositories contributed two warnings each. The warning intervals therefore come from a seeded percentile bootstrap that resamples repositories, not findings. The repository-level exit-`1` rate uses Wilson. The first published version of this section used Wilson for the warnings too, which was slightly too narrow.
- *Search ranking.* The largest search result count for any draw was 45, well under GitHub's 1,000-result cap, so every draw picked uniformly from that day's complete result set, and best-match ordering did not affect selection.
- *Language weighting.* Each draw picked JavaScript or TypeScript with equal probability, so the pooled rates weight the two languages roughly equally rather than by their share of the population. The per-language split above lets readers reweight; the two languages give similar rates, but with 18 and 32 repositories that comparison is weak.
- *Manifest check in the sampler.* The sampler treated any parseable `package.json` as valid, while the scanner accepts only JSON objects. This is now fixed in `scripts/fieldtest.js`. It did not affect Run 5: no sampled repository received `PACKAGE_JSON_INVALID`.

**What this shows.**

- **Every blocking finding was factually true (14 / 14), but most were policy rather than actionable.** Ten of the twelve `TEST_SCRIPT_MISSING` failures are repositories with no tests at all: templates, documentation sites, small apps, and one grammar extension. The finding is correct, but failing the build of a repository that deliberately has no tests is what a maintainer would experience as noise. Whether "no tests" should be blocking is a product decision.
- **Two warning checks produce most of the false findings.**
  - `ENV_EXAMPLE_MISSING` (7 of 8 false): it does not recognize committed `.env`, `.env.default`, `.env.development`, `.env.mock`, or `.env.test` files as documentation, and it reports framework- and tool-provided keys (Vite and WXT `import.meta.env.DEV` and browser flags, create-react-app's `PUBLIC_URL`, webpack DefinePlugin values) as user settings.
  - `BROWSER_TESTS_DETECTED` (5 of 8 false): it fires on browser packages in `devDependencies` even when the `npm test` command runs Vitest in node or jsdom and the browser suites are separate.
- `PRIVATE_REGISTRY` called `registry.npmmirror.com`, a public mirror, non-public.
- `README_SCRIPT_UNKNOWN`, `LOCKFILE_MISSING` for applications, and the root-test findings for repositories that do have tests were accurate and useful.

**Judgment interpretation made while judging.** The pre-registered `ENV_EXAMPLE_MISSING` rule did not say how to judge a finding whose keys were a mix of optional, documented, and tool-injected. The precedence used is recorded in `run5-judgments.json`: real if any key is required, otherwise false if any listed key is documented in a committed `.env*` file or injected by a framework or build tool, otherwise policy. Under the stricter alternative (false only when every listed key is wrong), `ENV_EXAMPLE_MISSING` becomes 0 real, 5 policy, and 3 false. Warning correctness becomes 17 / 26 = 65.4%, and warning precision is unchanged at 30.8%.

**Differences from the pre-registered expectations.**

- `glacier-studio/CoCo-Source-Code-Plan` and `vtex-apps/checkout-ui-custom` were predicted to fail with `TEST_SCRIPT_MISSING` but received the advisory `MONOREPO_ROOT_TEST_SCRIPT_MISSING`. The scanner treats a `private` root with nested `package.json` files as a workspace root, even without a workspace declaration. For vtex (separate `node/` and `react/` builder packages) that is defensible. For glacier (one vendored nested package) it is not, and it downgraded a blocking finding to a warning.
- `fedstack-org/aoi` was predicted to warn about the monorepo root test script but ended `incomplete`: Git cannot check out a path containing `:` on Windows. On a Linux runner the clone succeeds. The report repeats Git's error but does not explain that the path is invalid on Windows.
- `tidepool-org/uploader` got an unpredicted `README_SCRIPT_UNKNOWN` (the README runs `npm run test-e2e`, which does not exist). It was judged real.
- Every other predicted finding was observed, and no other blocking finding appeared.

**Not changed by this run.** No fix has been applied yet. The candidate fixes, in order of measured impact, are:

1. Accept committed non-secret `.env.*` files as environment documentation, and exclude framework- and tool-provided keys.
2. Fire `BROWSER_TESTS_DETECTED` only when the configuration selected by the test command enables a browser.
3. Decide whether a repository with no test files should get a distinct non-blocking finding instead of `TEST_SCRIPT_MISSING`.
4. Classify known public npm mirrors separately from private registries.
5. Require a workspace declaration or marker before downgrading a missing root test script.

Any fix should be followed by a rerun of the same sample with the same judgments.

### Run 5 rerun after fixes 1 and 2 (2026-10-30)

Fixes 1 and 2 above were implemented on the `claude/noise-fixes` branch with regressions in `test/scan-noise.test.js`. The same 50 repositories were rerun on the same day with `node scripts/fieldtest.js run`. Results are in [`field-test/run5-rerun-results.json`](field-test/run5-rerun-results.json) and judgments in [`field-test/run5-rerun-judgments.json`](field-test/run5-rerun-judgments.json). Findings unchanged from Run 5 keep their original judgment; changed or new findings were judged by the same pre-registered rules.

A first rerun exposed a regression before this result was recorded: `pixijs/pixi-react` lost its real `BROWSER_TESTS_DETECTED`, because `--project` in `tsc --project tsconfig.test.json && vitest run` was read as a Vitest project filter. Flags are now read only from the Vitest part of the command, there is a regression test, and the recorded rerun uses the corrected code.

| | Run 5 | Rerun |
|---|---:|---:|
| Report status `passed` / `passed_with_warnings` / `failed` / `incomplete` | 17 / 19 / 13 / 1 | 23 / 13 / 13 / 1 |
| Blocking findings: real / policy / false | 4 / 10 / 0 | 4 / 10 / 0 |
| Warnings: real / policy / false | 8 / 5 / 13 | 8 / 22 / 1 |
| Warning correctness (real + policy) | 13 / 26 = 50.0% | 30 / 31 = **96.8%** (95% cluster-bootstrap CI 85.7%–100.0%) |
| Warning precision (real) | 8 / 26 = 30.8% | 8 / 31 = 25.8% (95% cluster-bootstrap CI 9.1%–64.7%) |
| `BROWSER_TESTS_DETECTED`: real / false | 3 / 5 | 3 / 0 |
| Environment findings: real / policy / false | 0 / 1 / 7 | 0 / 18 / 0 |

**What changed.**

- All 5 false `BROWSER_TESTS_DETECTED` findings are gone, and all 3 real ones remain.
- All 7 false environment findings are gone. language-settings-manager, read-receipt, and hej no longer get any environment finding; lyricistant and TabsAsideExtension keep one listing only their genuinely optional keys.
- Six repositories moved from `passed_with_warnings` to `passed`: biud436/InitialEditor, react-token-autocomplete, connex, cdav-library, language-settings-manager, and read-receipt.
- The only false finding left is `PRIVATE_REGISTRY` on a public npm mirror (fix 4, not yet done).

**What did not get better, and why.**

- Warning *precision* did not rise. The remaining environment findings are all policy: optional settings such as release-signing secrets, analytics keys, and debug switches. Static inspection cannot tell an optional key from a required one, so these findings are true but rarely actionable.
- The warning *count* went up from 26 to 31. `tidepool-org/uploader` commits a `.env`, so it now gets one `ENV_KEY_MISSING` per undocumented key (13 findings) instead of one `ENV_EXAMPLE_MISSING`; `learn-japanese` gets 2. Grouping per-key environment findings into one finding per repository would remove this fan-out. It is a reporting change and is left for a separate decision.
- Blocking findings are unchanged: fix 3 (repositories with no tests) is still a product decision.

### Run 5 rerun with the no-tests policy (2026-10-30)

The test-script policy (fix 3) was implemented on the `claude/no-tests-policy` branch: a missing or placeholder test script fails only when the repository has tests that `npm test` cannot run, and a repository with no tests gets the `NO_TESTS_FOUND` warning (see [FINDINGS.md](FINDINGS.md#test-script-policy)). The same 50 repositories were rerun on the same day. All 49 reported commits matched the sampled head commits. Results are in [`field-test/run5-policy-results.json`](field-test/run5-policy-results.json) and judgments in [`field-test/run5-policy-judgments.json`](field-test/run5-policy-judgments.json); every finding keeps its earlier judgment.

| | Run 5 | Env and browser rerun | No-tests policy rerun |
|---|---:|---:|---:|
| Repositories failing (exit 1) | 13 | 13 | **3** |
| Exit-1 repositories justified by a real blocking finding | 3 / 13 | 3 / 13 | **3 / 3** |
| Blocking findings: real / policy / false | 4 / 10 / 0 | 4 / 10 / 0 | **4 / 0 / 0** |
| Warnings: real / policy / false | 8 / 5 / 13 | 8 / 22 / 1 | 8 / 32 / 1 |
| Report status `passed` / `passed_with_warnings` / `failed` / `incomplete` | 17 / 19 / 13 / 1 | 23 / 13 / 13 / 1 | 23 / 23 / 3 / 1 |

Exactly the 10 `TEST_SCRIPT_MISSING` findings judged *policy* (repositories with no tests) became `NO_TESTS_FOUND` warnings; no other finding changed. The three repositories that still fail are wardellbagby/lyricistant and FluffyBubu/cypress-sandbox (test suites that `npm test` cannot run) and tidepool-org/uploader (its README runs a script that does not exist). Two details of the policy mattered for this result: Cypress `*.cy.js` files count as tests, so cypress-sandbox still fails; and files under `test/` count only when they use a test API, so vuejs/repl's dev playground and peer-dial's example programs no longer make those repositories fail.

The warning count rose from 31 to 41 because the 10 downgraded findings are now warnings. They are all true but are policy, which is why warning precision fell to 8 / 41 while warning correctness rose to 40 / 41 (97.6%).

## Run 6: top 100 most-depended-on npm packages (pre-registered)

Runs 1–5 measured hand-picked repositories and a random sample of small and mid-sized projects. Run 6 measures the repositories behind the npm packages that the most other packages depend on. This section, the tooling, and the sample were committed and pushed before any CloneProof command ran against these repositories.

### Population and selection

- **Ranking:** npm packages ordered by `dependent_packages_count`, descending, from `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages?sort=dependent_packages_count&order=desc&per_page=100&page=N`. Pages 1–5 (500 packages) were fetched on 2026-10-30 at 18:20 UTC with `node scripts/fieldtest.js ranking --pages 5 --out docs/field-test/run6-ranking.json`. The raw rows used (rank, name, dependent-package count, repository URL, fetch time per page) are in [`field-test/run6-ranking.json`](field-test/run6-ranking.json).
- **Selection:** `node scripts/fieldtest.js sample-list --ranking docs/field-test/run6-ranking.json --count 100 --out docs/field-test/run6-sample.json` walks the ranking in order. For each package it:
  1. normalizes `repository_url` to a GitHub `owner/repo` (strips `git+`, `.git`, trailing slashes, and `/tree/...` subpaths); a URL outside github.com is skipped as `not-github`, and a missing URL as `no-repository-url`;
  2. resolves renames and redirects with `gh api repos/OWNER/REPO` and uses the returned `full_name`;
  3. skips repositories that are missing (`not-found`), private, archived, or have no root `package.json`;
  4. keeps each repository once, credited to its highest-ranked package, and records every later package in the walked range that maps to it (`alsoProvides`);
  5. stops at 100 unique repositories.
- **Outcome:** the walk reached rank 153. 100 repositories were accepted and 17 packages were skipped, all because their repository is archived. Every package in the walked range had a GitHub repository URL, and every accepted repository has a root `package.json`. 36 more packages mapped to a repository already in the sample, for example 15 Babel packages to `babel/babel` and 7 `@types/*` packages to `DefinitelyTyped/DefinitelyTyped`.
- **Pre-run facts:** for each repository, the same facts as Run 5 (default-branch head commit, root lockfiles, `scripts.test` kind, `packageManager`, workspaces, `private`), read through the GitHub API between 18:20 and 18:25 UTC. Nothing was cloned or executed while sampling.

**Framing.** CloneProof checks the repository **root**. Many of these packages are published from a sub-folder of a monorepo, so the results describe "cloning this repository and setting it up", not "installing this package from npm". These are among the most widely used and best-maintained projects in the ecosystem, so the sample is not typical of Node.js repositories.

Skipped packages:

| Rank | Package | Repository | Reason |
|---:|---|---|---|
| 18 | `babel-eslint` | `babel/babel-eslint` | archived |
| 31 | `css-loader` | `webpack/css-loader` | archived |
| 34 | `cross-env` | `kentcdodds/cross-env` | archived |
| 42 | `babel-preset-env` | `babel/babel-preset-env` | archived |
| 43 | `style-loader` | `webpack/style-loader` | archived |
| 44 | `tslint` | `palantir/tslint` | archived |
| 49 | `node-sass` | `sass/node-sass` | archived |
| 61 | `file-loader` | `webpack-contrib/file-loader` | archived |
| 63 | `prop-types` | `meta/prop-types` | archived |
| 81 | `url-loader` | `webpack-contrib/url-loader` | archived |
| 86 | `rollup-plugin-node-resolve` | `rollup/rollup-plugin-node-resolve` | archived |
| 88 | `istanbul` | `gotwarlost/istanbul` | archived |
| 89 | `rollup-plugin-terser` | `TrySound/rollup-plugin-terser` | archived |
| 91 | `rollup-plugin-babel` | `rollup/rollup-plugin-babel` | archived |
| 101 | `rollup-plugin-commonjs` | `rollup/rollup-plugin-commonjs` | archived |
| 115 | `extract-text-webpack-plugin` | `webpack-contrib/extract-text-webpack-plugin` | archived |
| 148 | `eslint-loader` | `webpack-contrib/eslint-loader` | archived |

### Sample

Language is GitHub's primary language for the repository. `(+N)` means N more packages in the walked range map to the same repository. Long `packageManager` hashes are shortened.

| Rank | Package | Repository | Head commit | Language | Stars | Root lockfiles | `scripts.test` | `packageManager` | Expected findings |
|---:|---|---|---|---|---:|---|---|---|---|
| 1 | `typescript` | `microsoft/TypeScript` | `f2c93ea86827` | Go | 111681 | `package-lock.json` | present (workspaces) | `npm@11.19.1+sha512…` | none |
| 2 | `eslint` | `eslint/eslint` | `12cbff4125db` | JavaScript | 27601 | none | present (workspaces) | — | `LOCKFILE_MISSING` |
| 3 | `react` (+3) | `react/react` | `952f45b70dab` | JavaScript | 251765 | `yarn.lock` | present (workspaces) | `yarn@1.22.22` | none |
| 4 | `mocha` | `mochajs/mocha` | `5b5afa7b12e3` | JavaScript | 22916 | `package-lock.json` | present | — | none |
| 5 | `@types/node` (+7) | `DefinitelyTyped/DefinitelyTyped` | `72e15dbdd808` | TypeScript | 51461 | none | present (workspaces) | `pnpm@10.30.1+sha512…` | `LOCKFILE_MISSING` |
| 6 | `jest` (+1) | `jestjs/jest` | `61050e9323e7` | TypeScript | 45467 | `yarn.lock` | present (workspaces) | `yarn@4.18.0` | none |
| 7 | `prettier` | `prettier/prettier` | `bed4edbb1cf2` | JavaScript | 52381 | `yarn.lock` | present | `yarn@4.18.1` | none |
| 8 | `webpack` | `webpack/webpack` | `a11411af097b` | JavaScript | 65969 | `yarn.lock` | present | `yarn@1.22.22+sha512…` | none |
| 10 | `@babel/core` (+15) | `babel/babel` | `633b97541f68` | TypeScript | 44056 | `yarn.lock` | present (workspaces) | `yarn@4.17.0+sha512…` | none |
| 11 | `babel-loader` | `babel/babel-loader` | `04a08e1c667b` | JavaScript | 4835 | `yarn.lock` | present | `yarn@4.17.0` | none |
| 12 | `eslint-plugin-import` | `import-js/eslint-plugin-import` | `a60d71548b0d` | JavaScript | 5957 | none | present | — | `LOCKFILE_MISSING` |
| 13 | `rimraf` | `isaacs/rimraf` | `051e6c72a703` | TypeScript | 5855 | `package-lock.json` | present | — | none |
| 14 | `chai` | `chaijs/chai` | `8cd999c735f0` | JavaScript | 8264 | `package-lock.json` | present | — | none |
| 16 | `lodash` | `lodash/lodash` | `2b5e6f7399a7` | JavaScript | 61275 | `package-lock.json` | present | — | none |
| 20 | `husky` | `typicode/husky` | `3f0023dc10d7` | JavaScript | 35370 | `package-lock.json` | missing | — | `TEST_SCRIPT_MISSING` |
| 21 | `rollup` | `rollup/rollup` | `1147f535769c` | JavaScript | 26305 | `package-lock.json` | present | — | none |
| 22 | `chalk` | `chalk/chalk` | `72110019e147` | JavaScript | 23337 | none | present | — | `LOCKFILE_MISSING` |
| 23 | `@typescript-eslint/eslint-plugin` (+1) | `typescript-eslint/typescript-eslint` | `bdf0a9c5fc58` | TypeScript | 16459 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.15.0+sha512…` | none |
| 25 | `tslib` | `microsoft/tslib` | `8d6f9cdef0a2` | TypeScript | 1345 | none | missing | — | `LOCKFILE_MISSING`, `TEST_SCRIPT_MISSING` |
| 26 | `ts-node` | `TypeStrong/ts-node` | `ddb05ef23be9` | TypeScript | 13118 | `yarn.lock` | present | `yarn@3.4.1` | none |
| 27 | `eslint-config-prettier` | `prettier/eslint-config-prettier` | `bd6e6171434c` | JavaScript | 5900 | `yarn.lock` | present | `yarn@4.18.0` | none |
| 28 | `webpack-cli` | `webpack/webpack-cli` | `02a85ac404b4` | JavaScript | 2621 | `package-lock.json` | present (workspaces) | — | none |
| 30 | `ts-jest` | `kulshekhar/ts-jest` | `48153cec2954` | TypeScript | 7073 | `package-lock.json` | present | — | none |
| 32 | `eslint-plugin-react` | `jsx-eslint/eslint-plugin-react` | `da5431790717` | JavaScript | 9292 | none | present | — | `LOCKFILE_MISSING` |
| 33 | `eslint-plugin-prettier` | `prettier/eslint-plugin-prettier` | `e6dd27a4e401` | JavaScript | 3655 | `yarn.lock` | present | `yarn@4.18.1` | none |
| 36 | `axios` | `axios/axios` | `9d11464a75ee` | JavaScript | 109308 | `package-lock.json` | present | — | none |
| 37 | `vue` | `vuejs/core` | `24c9d0bffb22` | TypeScript | 54799 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.11.2` | none |
| 38 | `express` | `expressjs/express` | `1c6f1b0fe400` | JavaScript | 69580 | none | present | — | `LOCKFILE_MISSING` |
| 40 | `autoprefixer` | `postcss/autoprefixer` | `a7dbf4de8763` | JavaScript | 22198 | `pnpm-lock.yaml` | present (workspaces) | — | none |
| 41 | `webpack-dev-server` | `webpack/webpack-dev-server` | `9a6472e52f88` | JavaScript | 7846 | `package-lock.json` | present | — | none |
| 46 | `lint-staged` | `lint-staged/lint-staged` | `48f9f4ea4b88` | JavaScript | 14752 | `package-lock.json` | present | — | none |
| 47 | `gulp` | `gulpjs/gulp` | `61f22dc11bb1` | JavaScript | 32915 | none | present | — | `LOCKFILE_MISSING` |
| 48 | `sass-loader` | `webpack/sass-loader` | `35cf965aa2c8` | JavaScript | 3889 | `package-lock.json` | present | — | none |
| 50 | `commander` | `tj/commander.js` | `ba6d13ddb424` | JavaScript | 28446 | `package-lock.json` | present | — | none |
| 51 | `fs-extra` | `jprichardson/node-fs-extra` | `1e223d3b1e26` | JavaScript | 9595 | none | present | — | `LOCKFILE_MISSING` |
| 52 | `sinon` | `sinonjs/sinon` | `41c89bfc87da` | JavaScript | 9752 | `package-lock.json` | present | — | none |
| 53 | `vue-template-compiler` | `vuejs/vue` | `9e8870794008` | TypeScript | 212487 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@8.9.2` | none |
| 55 | `core-js` | `zloirock/core-js` | `479a799d782c` | JavaScript | 25524 | `package-lock.json` | present (workspaces) | — | none |
| 58 | `html-webpack-plugin` | `jantimon/html-webpack-plugin` | `9e342d2202e1` | JavaScript | 10720 | `package-lock.json` | present | — | none |
| 59 | `@rollup/plugin-node-resolve` (+2) | `rollup/plugins` | `b09437adcd70` | JavaScript | 3762 | `pnpm-lock.yaml` | missing (workspaces) | `pnpm@9.5.0` | `MONOREPO_ROOT_TEST_SCRIPT_MISSING` |
| 60 | `nyc` | `istanbuljs/nyc` | `908620475199` | JavaScript | 5763 | `package-lock.json` | present | — | none |
| 62 | `eslint-plugin-promise` | `eslint-community/eslint-plugin-promise` | `51c6308694da` | JavaScript | 1005 | `package-lock.json` | present | — | none |
| 64 | `eslint-plugin-node` | `mysticatea/eslint-plugin-node` | `8ef07af5711b` | JavaScript | 956 | none | present | — | `LOCKFILE_MISSING` |
| 65 | `request` | `request/request` | `3c0cddc7c8eb` | JavaScript | 25485 | none | present | — | `LOCKFILE_MISSING` |
| 66 | `eslint-plugin-jsx-a11y` | `jsx-eslint/eslint-plugin-jsx-a11y` | `8f75961d965e` | JavaScript | 3632 | none | present | — | `LOCKFILE_MISSING` |
| 68 | `moment` | `moment/moment` | `c2a703a4d84a` | JavaScript | 47885 | `pnpm-lock.yaml` | present | `pnpm@11.22.0` | none |
| 69 | `coveralls` | `nickmerwin/node-coveralls` | `933dd331b763` | JavaScript | 1063 | `package-lock.json` | present | — | none |
| 70 | `npm-run-all` | `mysticatea/npm-run-all` | `bf91f94ce597` | JavaScript | 5834 | none | present | — | `LOCKFILE_MISSING` |
| 71 | `karma` | `karma-runner/karma` | `84f85e7016ef` | JavaScript | 11952 | `package-lock.json` | present | — | none |
| 74 | `eslint-config-standard` | `standard/eslint-config-standard` | `3dacfca5b476` | TypeScript | 2643 | `package-lock.json` | present | — | none |
| 75 | `postcss-loader` | `webpack/postcss-loader` | `ed3e1f7592a5` | JavaScript | 2839 | `package-lock.json` | present | — | none |
| 76 | `eslint-plugin-standard` | `standard/eslint-plugin-standard` | `ca587fc3506b` | JavaScript | 126 | none | present | — | `LOCKFILE_MISSING` |
| 77 | `glob` | `isaacs/node-glob` | `d1bfd61f8eda` | TypeScript | 8707 | `package-lock.json` | present | — | none |
| 78 | `inquirer` | `SBoudrias/Inquirer.js` | `34d7d364bc1d` | TypeScript | 21639 | `yarn.lock` | present (workspaces) | `yarn@4.18.1+sha512…` | none |
| 80 | `eslint-plugin-vue` | `vuejs/eslint-plugin-vue` | `9bde0bff1bf3` | TypeScript | 4589 | none | present | — | `LOCKFILE_MISSING` |
| 82 | `debug` | `debug-js/debug` | `666dbc506809` | JavaScript | 11456 | none | present | — | `LOCKFILE_MISSING` |
| 84 | `ts-loader` | `TypeStrong/ts-loader` | `93d692541bd0` | TypeScript | 3484 | `package-lock.json` | present | — | none |
| 85 | `react-scripts` | `react/create-react-app` | `6254386531d2` | JavaScript | 103234 | `package-lock.json` | present (workspaces) | — | none |
| 87 | `sass` | `sass/dart-sass` | `1f895ca5bff6` | Dart | 4238 | none | missing | — | `LOCKFILE_MISSING`, `TEST_SCRIPT_MISSING` |
| 90 | `eslint-config-airbnb` (+1) | `airbnb/javascript` | `8ed19247bef1` | JavaScript | 148031 | none | present | — | `LOCKFILE_MISSING` |
| 92 | `@testing-library/react` | `testing-library/react-testing-library` | `20ce75f2907c` | JavaScript | 19675 | none | present | `yarn@1.22.22+sha1.ac34549e6aa8e7ead463a7407e1c7390f61a6610` | `LOCKFILE_MISSING` |
| 93 | `semver` | `npm/node-semver` | `7257c1423947` | JavaScript | 5476 | none | present | — | `LOCKFILE_MISSING` |
| 94 | `yargs` | `yargs/yargs` | `8021675da057` | JavaScript | 11506 | `package-lock.json` | present | — | none |
| 95 | `dotenv` | `motdotla/dotenv` | `3d11a6e4e5b9` | JavaScript | 20557 | `package-lock.json` | present | — | none |
| 97 | `rxjs` | `ReactiveX/rxjs` | `54796b38a57e` | TypeScript | 31709 | `pnpm-lock.yaml` | missing (workspaces) | `pnpm@10.34.5` | `MONOREPO_ROOT_TEST_SCRIPT_MISSING` |
| 98 | `@vue/cli-service` (+2) | `vuejs/vue-cli` | `7eb93c169c75` | JavaScript | 29505 | `yarn.lock` | present (workspaces) | `yarn@1.22.11` | none |
| 99 | `uuid` | `uuidjs/uuid` | `8eed10acf6b1` | TypeScript | 15345 | `package-lock.json` | present | `npm@12.0.2` | none |
| 102 | `@storybook/react` (+3) | `storybookjs/storybook` | `43a13889a499` | TypeScript | 91413 | `yarn.lock` | present (workspaces) | `yarn@4.18.0` | none |
| 104 | `karma-chrome-launcher` | `karma-runner/karma-chrome-launcher` | `276f829b0be7` | JavaScript | 474 | `package-lock.json` | present | — | none |
| 108 | `grunt` | `gruntjs/grunt` | `50a8a686522b` | JavaScript | 12234 | none | present | — | `LOCKFILE_MISSING` |
| 109 | `less` | `less/less.js` | `713331655e43` | JavaScript | 17008 | `package-lock.json`, `pnpm-lock.yaml` | present (workspaces) | `pnpm@9.15.9` | none |
| 110 | `postcss` | `postcss/postcss` | `2455ac8212fe` | TypeScript | 28966 | `pnpm-lock.yaml` | present (workspaces) | — | none |
| 111 | `nodemon` | `remy/nodemon` | `6812a7472215` | JavaScript | 26658 | `package-lock.json` | present | — | none |
| 112 | `rollup-plugin-typescript2` | `ezolenko/rollup-plugin-typescript2` | `4cff90bbe88a` | TypeScript | 824 | `package-lock.json` | present | — | none |
| 113 | `tape` | `tape-testing/tape` | `223d58ebbde2` | JavaScript | 5798 | none | present | — | `LOCKFILE_MISSING` |
| 116 | `@testing-library/jest-dom` | `testing-library/jest-dom` | `3782c78b3dc9` | JavaScript | 4606 | none | present | — | `LOCKFILE_MISSING` |
| 118 | `async` | `caolan/async` | `3921e54bd070` | JavaScript | 28116 | `package-lock.json` | present | — | none |
| 119 | `antd` | `ant-design/ant-design` | `aab929818837` | TypeScript | 100014 | none | present | — | `LOCKFILE_MISSING` |
| 120 | `vue-loader` | `vuejs/vue-loader` | `698636508e08` | TypeScript | 4956 | `pnpm-lock.yaml` | present | `pnpm@8.12.0` | none |
| 123 | `typedoc` | `TypeStrong/typedoc` | `6d8c856bbb46` | TypeScript | 8453 | `pnpm-lock.yaml` | present | — | none |
| 124 | `semantic-release` | `semantic-release/semantic-release` | `04c1923646eb` | JavaScript | 24148 | `package-lock.json` | present | `npm@12.0.2+sha512…` | none |
| 126 | `classnames` | `JedWatson/classnames` | `abd6314010de` | JavaScript | 17772 | `package-lock.json` | present | — | none |
| 127 | `node-fetch` | `node-fetch/node-fetch` | `8b3320d2a7c0` | JavaScript | 8846 | none | present | — | `LOCKFILE_MISSING` |
| 128 | `mkdirp` | `isaacs/node-mkdirp` | `fdf6005432c2` | TypeScript | 199 | `package-lock.json` | present | — | none |
| 129 | `ava` | `avajs/ava` | `8640039a46c8` | JavaScript | 20826 | `pnpm-lock.yaml` | present (workspaces) | — | none |
| 130 | `ora` | `sindresorhus/ora` | `b204360b0df9` | JavaScript | 9768 | none | present | — | `LOCKFILE_MISSING` |
| 131 | `minimist` | `minimistjs/minimist` | `ecfdaea23e79` | JavaScript | 663 | none | present | — | `LOCKFILE_MISSING` |
| 132 | `standard` | `standard/standard` | `753309b21bfd` | JavaScript | 29426 | none | present | — | `LOCKFILE_MISSING` |
| 134 | `@commitlint/config-conventional` (+1) | `conventional-changelog/commitlint` | `f9dc49ce7073` | TypeScript | 18791 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.16.0+sha512…` | none |
| 135 | `shelljs` | `shelljs/shelljs` | `060e8ac15aa3` | JavaScript | 14402 | `package-lock.json` | present | — | none |
| 136 | `vue-router` | `vuejs/router` | `593d7ad9ff99` | TypeScript | 4707 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.14.0` | none |
| 137 | `@testing-library/user-event` | `testing-library/user-event` | `1951eb77cc19` | TypeScript | 2335 | none | present | — | `LOCKFILE_MISSING` |
| 138 | `webpack-merge` | `survivejs/webpack-merge` | `400ba410bf88` | TypeScript | 2682 | `package-lock.json` | present | — | none |
| 139 | `jsdom` | `jsdom/jsdom` | `27614bf74750` | JavaScript | 21741 | `package-lock.json` | present | — | none |
| 143 | `vite` | `vitejs/vite` | `90bc034a97e7` | TypeScript | 83626 | `pnpm-lock.yaml` | present (workspaces) | `pnpm@12.15.0` | none |
| 145 | `browserify` | `browserify/browserify` | `cd60f059d7a8` | JavaScript | 14692 | none | present | — | `LOCKFILE_MISSING` |
| 146 | `less-loader` | `webpack/less-loader` | `7a40320f5218` | JavaScript | 960 | `package-lock.json` | present | — | none |
| 150 | `gh-pages` | `tschaub/gh-pages` | `48f62a750216` | JavaScript | 3352 | `package-lock.json` | present | — | none |
| 152 | `bluebird` | `petkaantonov/bluebird` | `c220cfe48086` | JavaScript | 20465 | `package-lock.json` | present | — | none |
| 153 | `eslint-plugin-jest` | `jest-community/eslint-plugin-jest` | `af4ad59a1e03` | TypeScript | 1174 | `yarn.lock` | present | `yarn@4.18.1` | none |

Summary of the facts: 95 repositories have a test script and 5 do not; 24 declare workspaces; 30 have no root lockfile, 42 commit only `package-lock.json`, 13 `yarn.lock`, 14 `pnpm-lock.yaml`, and 1 both `package-lock.json` and `pnpm-lock.yaml`; 29 declare `packageManager` (14 Yarn, 12 pnpm, 3 npm).

### Pre-registered expectations

`expected` in `run6-sample.json` uses the Run 5 rules unchanged. Two notes apply to the CloneProof version under test (v0.2.0, which added the test-script policy after Run 5):

1. A missing or placeholder test script is reported as `TEST_SCRIPT_MISSING` / `TEST_SCRIPT_PLACEHOLDER` only when the repository has tests that `npm test` cannot run, and as the `NO_TESTS_FOUND` warning otherwise. The sampler does not look for test files, so either code counts as matching a `TEST_SCRIPT_MISSING` or `TEST_SCRIPT_PLACEHOLDER` prediction.
2. `SBoudrias/Inquirer.js` reports 4,793,604 KiB of history, above CloneProof's 4 GiB API sanity limit, so it is predicted to stop with `GITHUB_REPOSITORY_TOO_LARGE` before cloning.

`README_SCRIPT_UNKNOWN`, `LOCKFILE_OUT_OF_SYNC`, environment, and clone-limit findings are not predicted.

### Procedure

- **Code under test:** CloneProof v0.2.0, commit `79bbe788e868`. `src/` does not change during Run 6.
- **Command:** `node scripts/fieldtest.js run --sample docs/field-test/run6-sample.json --out docs/field-test/run6-results.json --reports reports/field/run6`. This runs `node src/cli.js check <url> --format json` once per repository: static inspection only, one isolated shallow clone per repository, no `verify`, no install, and no repository code executed. Reports stay in the ignored `reports/` folder.
- **Host:** the same Windows host as Run 5 (Node.js 24). Git on Windows cannot check out paths containing characters such as `:`. A clone failure caused by that is reported separately as host-specific and excluded from the accuracy tables.
- **Preflight:** 100 preflights exceed GitHub's unauthenticated limit, so `CLONEPROOF_GITHUB_TOKEN` is set from `gh auth token` in the environment of the run process only. CloneProof uses it only for the size and visibility preflight, and it is never written to a file or report.
- **Recorded:** start and end time, Node version, OS, and how many reported commits differ from the sampled head commits.
- **Stop rule:** if more than 10 runs end without a report (tool errors rather than repository findings), the run stops and the errors are reported instead.

### Judging rules

The Run 5 judging rules apply verbatim (see [Run 5, Judging rules](#judging-rules)). Every `failed` and `warning` finding is judged **real**, **policy**, or **false**, with the same code-specific rules and the same precedence for environment findings recorded in `run5-judgments.json`:

> ENV_EXAMPLE_MISSING: real if any listed key is required with no default; otherwise false if any listed key is documented in a committed .env* file or injected by a framework or build tool; otherwise policy.

The precedence applies equally to `ENV_KEY_MISSING`. `NO_TESTS_FOUND`, added after Run 5, is judged by the Run 5 test-script rule: policy if the repository has no tests at all; false if it has tests or a working root test command. Findings are judged per repository and code, as in Run 5. For codes that produce one finding per key, the results section also reports counts per repository, so one repository cannot dominate the totals.

Reported metrics are the same as Run 5: precision (real ÷ total) and correctness ((real + policy) ÷ total) for blocking and warning findings, with the Wilson or repository-cluster bootstrap 95% intervals printed by `scripts/fieldtest.js summary`, and the share of exit-`1` repositories justified by at least one real blocking finding.

Limitation: one reviewer (Claude, an AI assistant) makes every judgment by reading each repository at the checked commit through the GitHub API, and is not blind to CloneProof's output. Every judgment records its reason so anyone can re-judge.

### Run 6 results

The pre-registration was committed as `c382a2f` and pushed at 18:26 UTC on 2026-10-30, before the run. All 100 checks ran on the Windows host from 18:26:34 to 18:40:16 UTC with CloneProof v0.2.0 (`79bbe788e868`, `src/` unchanged), Node.js 24.18.0, and an authenticated preflight (`target.preflightReason: checked` for every repository). Every run produced a report, so the stop rule was not triggered and there were no tool errors. All 93 reported commits match the sampled head commits; the other 7 repositories stopped before cloning, so they report none. No clone failed because of a Windows-only path, so no result is host-specific. Median duration was 3.7 s and the longest was 87 s. Raw results are in [`field-test/run6-results.json`](field-test/run6-results.json), and every judgment with its reason is in [`field-test/run6-judgments.json`](field-test/run6-judgments.json). Reproduce the tables with `node scripts/fieldtest.js summary --results docs/field-test/run6-results.json --judgments docs/field-test/run6-judgments.json --sample docs/field-test/run6-sample.json`.

| Report status | Repositories | Exit code |
|---|---:|---|
| `passed` | 31 | 0 |
| `passed_with_warnings` | 56 | 0 |
| `failed` | 6 | 1 |
| `blocked` | 7 | 2 |

| Findings | Total | Real | Policy | False | Precision (real) | Correctness (real + policy) |
|---|---:|---:|---:|---:|---|---|
| Blocking (failed) | 10 | 1 | 0 | 9 | 1 / 10 = **10.0%** (95% cluster-bootstrap CI 0.0%–50.0%) | 1 / 10 = **10.0%** (95% cluster-bootstrap CI 0.0%–50.0%) |
| Warning | 73 | 10 | 46 | 17 | 10 / 73 = **13.7%** (95% cluster-bootstrap CI 6.8%–21.6%) | 56 / 73 = **76.7%** (95% cluster-bootstrap CI 67.1%–85.7%) |

Repositories with exit `1`: 6 of 100. Justified by at least one real blocking finding: 1 / 6 = **16.7%** (95% Wilson CI 3.0%–56.4%).

| Language | Repositories | Real / blocking | Real / warnings |
|---|---:|---:|---:|
| Dart | 1 | 0 / 0 | 0 / 2 |
| Go | 1 | 0 / 0 | 0 / 0 |
| JavaScript | 68 | 1 / 10 | 7 / 54 |
| TypeScript | 30 | 0 / 0 | 3 / 17 |

| Code | Status | Total | Real | Policy | False |
|---|---|---:|---:|---:|---:|
| `LOCKFILE_OUT_OF_SYNC` | failed | 1 | 1 | 0 | 0 |
| `README_SCRIPT_UNKNOWN` | failed | 9 | 0 | 0 | 9 |
| `BROWSER_TESTS_DETECTED` | warning | 6 | 6 | 0 | 0 |
| `ENGINES_NODE_UNSATISFIED` | warning | 1 | 0 | 0 | 1 |
| `ENV_EXAMPLE_MISSING` | warning | 30 | 0 | 16 | 14 |
| `ENV_KEY_MISSING` | warning | 1 | 0 | 1 | 0 |
| `LOCKFILE_MISSING` | warning | 29 | 0 | 29 | 0 |
| `MONOREPO_ROOT_TEST_SCRIPT_MISSING` | warning | 3 | 3 | 0 | 0 |
| `MULTIPLE_LOCKFILES` | warning | 1 | 1 | 0 | 0 |
| `NO_TESTS_FOUND` | warning | 2 | 0 | 0 | 2 |

**Blocked repositories (not in the accuracy tables).** Seven repositories stopped at CloneProof's safety limits before scanning, with exit `2`:

- `SBoudrias/Inquirer.js`: `GITHUB_REPOSITORY_TOO_LARGE`, as pre-registered, because GitHub reports 4.6 GiB of history.
- `microsoft/TypeScript`, `DefinitelyTyped/DefinitelyTyped`, `webpack/webpack`, `babel/babel`, `rollup/rollup`: `GITHUB_CHECKOUT_LIMIT_EXCEEDED`, more than the 10,000-file checkout limit.
- `jsdom/jsdom`: `GITHUB_CHECKOUT_LIMIT_EXCEEDED`, a 41.6 MB file (`test/web-platform-tests/wpt-manifest.json`) above the 25 MiB per-file limit.

The limits work as designed, but they mean CloneProof cannot check 7% of the most-depended-on repositories with its defaults.

**Statistical notes.**

- *Intervals.* `istanbuljs/nyc` contributed 5 of the 10 blocking findings, so blocking findings are clustered and the summary script uses the repository-cluster bootstrap. With only 6 repositories behind those findings, the blocking interval is very wide; at the repository level, 5 of the 6 failing repositories failed only because of false findings.
- *Environment fan-out.* Every environment finding but one is `ENV_EXAMPLE_MISSING`, which is one finding per repository. The only `ENV_KEY_MISSING` is one key in `storybookjs/storybook`. No repository dominates the environment totals in this run.
- *Population.* This is a ranked population, not a random sample, so the intervals describe uncertainty about the judging process on these 100 repositories, not about a wider population.

**Judgment interpretations made while judging.** The Run 5 rules did not say how to treat some kinds of environment keys and tests. The interpretations used are recorded once in `run6-judgments.json` (`interpretations`) and applied everywhere:

1. Keys set by the operating system, shell, Git, or a CI service count as injected by a tool.
2. Keys a tool sets for itself or its child processes, and build-time feature flags, count as injected.
3. Keys needed only for maintainer-only services count as optional.
4. A mis-parsed key, or a key mentioned only in a comment, is not read by the code.
5. Shell and Dart test suites count as tests.

Under the stricter alternative (an environment finding is false only when every listed key is wrong), `ENV_EXAMPLE_MISSING` becomes 0 real, 24 policy, and 6 false. Warning correctness then becomes 64 / 73 = 87.7%, and warning precision is unchanged.

**What this shows.**

- **The one blocking check that misfired is `README_SCRIPT_UNKNOWN`, and it misfired on every library that triggered it.** All 9 findings, in 5 repositories, come from README usage sections that show the reader how to add a script to *their own* `package.json` and then run it: `webpack-dev-server`, `lint-staged`, `nyc`, `coveralls`, `gh-pages`. In each case, the script is defined in a README code block a few lines above the command. These five repositories account for 5 of the 6 exit-`1` results. In Run 5 (mostly applications) its one finding was real; on popular libraries, whose READMEs are written for consumers, it is wrong every time it fires.
- **The one real blocking finding is `less/less.js`.** It commits a `package-lock.json` that is missing three root devDependencies, so `npm ci` refuses, while the project itself requires pnpm (`packageManager`, `postinstall: npx only-allow pnpm`) and commits `pnpm-lock.yaml`. CloneProof reports both the out-of-sync lockfile and the conflicting lockfiles.
- **`BROWSER_TESTS_DETECTED` was right all 6 times** (`chai`, `axios`, `vuejs/core`, `karma`, `debug`, `karma-chrome-launcher`): in each, `npm test` starts a real browser through Playwright, Karma, or web-test-runner. The Run 5 fix (count Vitest only when the selected configuration enables browser mode) held: `axios` and `vuejs/core` were detected through their Vitest browser projects.
- **Missing root test scripts in workspaces were real** (`tslib`, `rollup/plugins`, `rxjs`: tests exist, and `npm test` at the root cannot run them).
- **`LOCKFILE_MISSING` is the most common finding, and it is entirely policy:** 29 published libraries do not commit a lockfile, a common choice for libraries.
- **Environment findings are mostly noise for libraries.** Of 31, none is real; 17 are optional debug or feature switches (policy) and 14 are false. The false ones are keys set by the OS, Git, CI services, or the tool itself (`GIT_DIR`, `HOMEPATH`, `COMP_CWORD`, `CF_PAGES`, `WEBPACK_SERVE`, `ROLLUP_WATCH`, `NYC_*`), build-time feature flags (`vuejs/vue`), plus two scanner bugs.

**Scanner bugs found (not fixed in this run).**

1. `README_SCRIPT_UNKNOWN` reports scripts that the README itself defines in an example `package.json` block for the reader's project.
2. Environment key parsing stops at `$`: `process.env.Wimp$ScrapDir` in `shelljs/shelljs` was reported as the key `Wimp`.
3. Environment references inside comments are counted: `postcss/postcss` was flagged for `NODE_DISABLE_COLORS` mentioned only in a `.d.ts` doc comment.
4. `ENGINES_NODE_UNSATISFIED` treats a major-only `.nvmrc` (`24`) as `24.0.0`; nvm resolves it to the latest 24.x, which satisfies `>= 24.10.0` (`semantic-release`).
5. `NO_TESTS_FOUND` ignores non-JavaScript and shell test suites (`typicode/husky`'s `test/*.sh`, `sass/dart-sass`'s Dart tests).
6. As in Run 5 (fix 5), `microsoft/tslib` was treated as a workspace root without a workspace declaration, which turned a predicted `TEST_SCRIPT_MISSING` failure into the advisory `MONOREPO_ROOT_TEST_SCRIPT_MISSING`. The finding is still true.

**Differences from the pre-registered expectations.**

- `DefinitelyTyped/DefinitelyTyped` was predicted to get `LOCKFILE_MISSING` but was blocked by the checkout limit before scanning; the other 5 limit-blocked repositories had no predicted findings.
- `typicode/husky` and `sass/dart-sass` (no test script) received `NO_TESTS_FOUND`, which the pre-registration counts as matching. Both judgments are false because those repositories have non-JavaScript test suites.
- `microsoft/tslib` received `MONOREPO_ROOT_TEST_SCRIPT_MISSING` instead of the predicted `TEST_SCRIPT_MISSING` (bug 6).
- `SBoudrias/Inquirer.js` stopped with `GITHUB_REPOSITORY_TOO_LARGE`, as predicted.
- Unpredicted findings: `BROWSER_TESTS_DETECTED` (6), `MULTIPLE_LOCKFILES` (`less.js`), and `ENGINES_NODE_UNSATISFIED` (`semantic-release`), plus the not-predicted classes (README, lockfile sync, environment).

**Landscape.** Of the 100 repositories:

- **Root lockfiles:** 42 commit only `package-lock.json`, 14 `pnpm-lock.yaml`, 13 `yarn.lock`, 1 both npm and pnpm lockfiles, none Bun, and 30 none.
- **`packageManager`:** 29 declare it (14 Yarn, 12 pnpm, 3 npm).
- **Node.js version:** 68 declare `engines.node`, 8 commit `.nvmrc`, and 5 commit `.node-version`. The only runtime disagreement CloneProof reported is the false `semantic-release` finding.
- **README script drift:** none of the 9 README findings was real.

**Candidate fixes, in order of measured impact:** (1) ignore README script references whose script is defined in a README code block, or that sit in a consumer-usage section; (2) for libraries, exclude OS, shell, Git, and CI variables and keys the tool sets itself, and skip comments; (3) parse full identifier characters, including `$`, in `process.env` keys; (4) compare major-only `.nvmrc` values as ranges; (5) count shell and non-JavaScript test suites before reporting `NO_TESTS_FOUND`; (6) offer a documented way to raise the checkout limits for very large repositories. Any fix should be followed by a rerun of this sample with these judgments.

### Run 6 rerun with the README fix (2026-10-30)

Scanner bug 1 (README scripts defined for the reader's own project) was fixed in PR #16 and is released in v0.2.1. The same 100 repositories were rerun on the same day with `node scripts/fieldtest.js run` and an authenticated preflight. Results are in [`field-test/run6-fix-results.json`](field-test/run6-fix-results.json). No finding is new, so every finding keeps its judgment in `run6-judgments.json`, and `summary` with those judgments reproduces the table below. One repository, `microsoft/tslib`, had moved to a new commit since sampling; its findings are unchanged.

| | Run 6 | Rerun with the README fix |
|---|---:|---:|
| Report status `passed` / `passed_with_warnings` / `failed` / `blocked` | 31 / 56 / 6 / 7 | 32 / 60 / 1 / 7 |
| Repositories failing (exit 1) | 6 | **1** |
| Exit-1 repositories justified by a real blocking finding | 1 / 6 | **1 / 1** |
| Blocking findings: real / policy / false | 1 / 0 / 9 | **1 / 0 / 0** |
| Warnings: real / policy / false | 10 / 46 / 17 | 10 / 46 / 17 |

Exactly the 9 false `README_SCRIPT_UNKNOWN` findings are gone, and no other finding changed. webpack-dev-server, lint-staged, nyc, and coveralls moved from `failed` to `passed_with_warnings`, and gh-pages to `passed`. Their README examples are now listed under the informational `README_OTHER_PROJECT_COMMANDS`. The only repository that still fails is `less/less.js`, whose stale `package-lock.json` is a real problem.

The Run 5 sample was also rerun with the fix. All 50 results are identical to the no-tests policy rerun, including `tidepool-org/uploader`'s real `README_SCRIPT_UNKNOWN`. Scanner bugs 2–6 are not fixed yet.

### Reruns with the remaining Run 6 fixes (2026-10-31)

Scanner bugs 2–5 above, plus Run 5's public-mirror false positive (Run 5 fix 4), were fixed on the `claude/false-finding-fixes` branch, with regressions in `test/scan-noise.test.js` and `test/test-suite-detection.test.js`. Both samples were rerun with an authenticated preflight. A first Run 6 attempt was discarded: DNS on the host stopped resolving `github.com` partway through, so 71 clones failed for a reason unrelated to CloneProof. The recorded run is a clean repeat.

- Results: [`field-test/run6-fixes-results.json`](field-test/run6-fixes-results.json) and [`field-test/run5-fixes-results.json`](field-test/run5-fixes-results.json).
- Judgments: [`field-test/run6-fixes-judgments.json`](field-test/run6-fixes-judgments.json). Unchanged findings keep their Run 6 judgment, and findings whose code or listed keys changed were re-judged by the same rules and interpretations. Run 5 findings are all unchanged except one removal, so `run5-policy-judgments.json` still applies.
- Moved repositories: four Run 6 repositories had moved to new commits since sampling (`react/react`, `microsoft/tslib`, `webpack/webpack-cli`, `zloirock/core-js`); their findings did not change.

| | Run 6 (v0.2.0) | v0.2.1 | With these fixes |
|---|---:|---:|---:|
| Report status `passed` / `passed_with_warnings` / `failed` / `blocked` | 31 / 56 / 6 / 7 | 32 / 60 / 1 / 7 | 37 / 53 / 3 / 7 |
| Repositories failing (exit 1), justified by a real blocking finding | 1 / 6 | 1 / 1 | **3 / 3** |
| Blocking findings: real / policy / false | 1 / 0 / 9 | 1 / 0 / 0 | **3 / 0 / 0** |
| Warnings: real / policy / false | 10 / 46 / 17 | 10 / 46 / 17 | **10 / 50 / 3** |
| Warning correctness (real + policy) | 76.7% | 76.7% | **60 / 63 = 95.2%** (95% cluster-bootstrap CI 89.2%–100.0%) |

| Code | Status | Total | Real | Policy | False |
|---|---|---:|---:|---:|---:|
| `LOCKFILE_OUT_OF_SYNC` | failed | 1 | 1 | 0 | 0 |
| `TEST_SCRIPT_MISSING` | failed | 2 | 2 | 0 | 0 |
| `BROWSER_TESTS_DETECTED` | warning | 6 | 6 | 0 | 0 |
| `ENV_EXAMPLE_MISSING` | warning | 23 | 0 | 20 | 3 |
| `ENV_KEY_MISSING` | warning | 1 | 0 | 1 | 0 |
| `LOCKFILE_MISSING` | warning | 29 | 0 | 29 | 0 |
| `MONOREPO_ROOT_TEST_SCRIPT_MISSING` | warning | 3 | 3 | 0 | 0 |
| `MULTIPLE_LOCKFILES` | warning | 1 | 1 | 0 | 0 |

**What changed in Run 6.**

- **Environment findings: 14 false → 3.**
  - **Gone:** keys set by the operating system, the shell, Git, CI services, or Rollup; keys the repository's own non-test code assigns; keys mentioned only in comments or `.d.ts` files; and the mis-parsed `Wimp`.
  - **Repositories that now pass outright:** lint-staged, postcss, rollup-plugin-typescript2, and shelljs.
  - **The 3 false findings left** come from injection that static reading cannot see: `vuejs/vue`'s build-time feature flags (defined in `scripts/feature-flags.js` and replaced by the build), CI variables that coveralls detects (`SURF_*`, `REVISION`), and `TEST_AVA`, which AVA's test helper passes to child processes.
- **`ENGINES_NODE_UNSATISFIED`.** The `semantic-release` warning is gone. The cause was not the major-only `.nvmrc`, as first recorded, but the space in `>= 24.10.0`: that range alternative was skipped as unparsable.
- **Test-script policy.**
  - `typicode/husky` (shell tests) and `sass/dart-sass` (Dart tests) changed from `NO_TESTS_FOUND` to the blocking `TEST_SCRIPT_MISSING`. Both are judged real by the pre-registered rule: tests exist, and `npm test` cannot run them.
  - Detection reads test files only. A husky or sass dependency, `.husky/` hook scripts, and fixture, test-data, or vendored folders never count; `test/test-suite-detection.test.js` covers both positive and negative cases.
  - Note for maintainers of primarily non-JavaScript projects such as dart-sass: the root `package.json` there serves JavaScript tooling, so a failing `npm test` check may feel like noise, even though the rule holds.
- **Policy findings.** Policy warnings rose from 46 to 50 because four environment findings that had been judged false now list only optional settings. Two optional-switch findings disappeared because the repository's own code sets those keys (`RTL_SKIP_AUTO_CLEANUP`, `AUTOPREFIXER_GRID`).

**Run 5.** One finding changed: the false `PRIVATE_REGISTRY` on `registry.npmmirror.com` (`glacier-studio/CoCo-Source-Code-Plan`) is gone.

| Run 5 | Blocking: real / policy / false | Warnings: real / policy / false | Warning correctness |
|---|---:|---:|---:|
| No-tests policy rerun | 4 / 0 / 0 | 8 / 32 / 1 | 97.6% |
| With these fixes | 4 / 0 / 0 | 8 / 32 / 0 | 40 / 40 = 100% |

None of the 10 Run 5 repositories without tests started failing. With every warning correct, the cluster bootstrap returns a zero-width interval, so the Run 5 warning interval is not informative.

**Still open.**

- Feature-flag and child-process injection (the 3 remaining false environment findings).
- Workspace detection without a workspace declaration (bug 6; `microsoft/tslib`).
- Raising the clone limits for very large repositories.
- Git hook commands are not read: a `.husky/pre-commit` that runs `npm test` in a repository without a test script would fail every commit, and CloneProof does not report it.

## Known limitations

1. **Sensitive-file omission applies to local folders only.** Local staging still omits `.env*`, npm configuration, credentials, and certificate/key files and reports `DOCKER_SENSITIVE_FILES_OMITTED`. Fresh public GitHub clones copy committed versions because they are already public; command-line flags still force `npm ci --ignore-scripts`.
2. **Symlink suites are blocked consistently but not reproduced.** Git-listed mode `120000` paths and real `lstat` symlinks are skipped during scanning and block Docker verification on every OS. A Windows checkout created with `core.symlinks=false` cannot be detected without Git metadata, and recreating symlinks inside the container is out of scope. The Windows symlink integration test remains skipped because creation returns `EPERM`.
3. **Browser binaries are not installed.** The pinned image contains Node but no Playwright/Chromium browser. `BROWSER_TESTS_DETECTED` explains this condition, but CloneProof does not download or execute browser installers.
4. **Lifecycle/install scripts are skipped.** Native modules such as bcrypt can fail after `npm ci --ignore-scripts`; `INSTALL_SCRIPTS_SKIPPED` is informational and test-phase failures explain the likely cause. CloneProof intentionally does not enable those scripts.
5. **The image must be pulled explicitly.** `--pull=never` blocks implicit image downloads, so the exact pinned digest must be present before Docker verification.
