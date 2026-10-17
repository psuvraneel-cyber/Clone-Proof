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

## Rerun after fixes

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

## Warning precision after environment filtering

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

## Planted-bug test

The offline suite in `test/planted-bugs.test.js` builds a realistic Node.js project in the operating-system temporary directory, confirms the healthy base is `passed`, then copies it for each single mutation. It covers the 13 requested mutations, including a whitespace-only README control. The suite runs `scanRepository` only; it never starts a target process.

The real-repository extension used read-only `git clone --depth 1` for `psuvraneel-cyber/Clone-Proof`, `typestack/class-validator`, and `motdotla/dotenv`, removed each checkout's `.git` directory, copied each checkout for every mutation, and invoked `node src/cli.js check <copy> --format json`. No target `npm`, test, build, lifecycle, or Docker command was run. Adaptations were recorded rather than silently omitted:

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

## Results

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
- The final host suite after the four fixes is **130 tests: 129 passed, 1 skipped** (the expected Windows symlink `EPERM` case). The Linux container suite is reported separately in the handoff checks.
- The final cleanup audit found no `cloneproof-github-*` temporary folders and no containers from `docker ps -a --filter name=cloneproof-verify`.

## Known limitations

1. **Sensitive-file omission applies to local folders only.** Local staging still omits `.env*`, npm configuration, credentials, and certificate/key files and reports `DOCKER_SENSITIVE_FILES_OMITTED`. Fresh public GitHub clones copy committed versions because they are already public; command-line flags still force `npm ci --ignore-scripts`.
2. **Symlink suites are blocked consistently but not reproduced.** Git-listed mode `120000` paths and real `lstat` symlinks are skipped during scanning and block Docker verification on every OS. A Windows checkout created with `core.symlinks=false` cannot be detected without Git metadata, and recreating symlinks inside the container is out of scope. The Windows symlink integration test remains skipped because creation returns `EPERM`.
3. **Browser binaries are not installed.** The pinned image contains Node but no Playwright/Chromium browser. `BROWSER_TESTS_DETECTED` explains this condition, but CloneProof does not download or execute browser installers.
4. **Lifecycle/install scripts are skipped.** Native modules such as bcrypt can fail after `npm ci --ignore-scripts`; `INSTALL_SCRIPTS_SKIPPED` is informational and test-phase failures explain the likely cause. CloneProof intentionally does not enable those scripts.
5. **The image must be pulled explicitly.** `--pull=never` blocks implicit image downloads, so the exact pinned digest must be present before Docker verification.
