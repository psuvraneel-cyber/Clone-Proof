# We fresh-cloned the top 100 npm packages. The biggest problem we found was in our own tool.

*Draft, not published. Every number below comes from committed files in this repository; see [How to reproduce](#how-to-reproduce).*

**Alternative titles**

1. Fresh-clone checks on the 100 most-depended-on npm repositories (HN, 63 characters)
2. What a static fresh-clone check finds in the 100 most-depended-on npm repos
3. We pre-registered a test of our own tool on the top 100 npm repositories

## TL;DR

We ran [CloneProof](https://github.com/psuvraneel-cyber/Clone-Proof), a static "will a fresh clone of this repository install and run?" checker, on the GitHub repositories of the 100 npm packages with the most dependents. We wrote down the method and the judging rules publicly before running a single check.

- **10 of 100 repositories had at least one real setup finding.** Six run a real browser as part of `npm test`, three are workspaces whose root `npm test` cannot run the tests, and one commits a stale npm lockfile next to the pnpm lockfile it actually uses.
- **9 of the 10 build-failing findings were false**, all from one check: CloneProof mistook README usage examples ("add this script to *your* `package.json`, then run it") for instructions about the repository itself. Only 1 of the 6 repositories it would have failed in CI deserved it.
- **7 of 100 repositories could not be checked at all** because they exceed CloneProof's clone safety limits: TypeScript, DefinitelyTyped, webpack, Babel, Rollup, and jsdom hit the 10,000-file or 25 MiB per-file limits, and Inquirer.js has 4.6 GiB of history.

The short version: these projects are in very good shape, and the most useful thing this study found was a set of bugs in CloneProof.

## Why fresh clones matter

A repository's own CI usually runs on a warm, configured machine. A new contributor, a reviewer, or an agent starts from `git clone` and the README. The gaps between those two worlds are small and annoying: a lockfile that `npm ci` rejects, a test command that quietly needs a browser, an environment variable nobody wrote down, a README command that no longer exists. CloneProof tries to find those gaps without running any of the repository's code.

## Method

**Population.** We took npm packages ordered by number of dependent packages from the [ecosyste.ms](https://packages.ecosyste.ms) npm registry API (fetched 2026-10-30), walked the list in order, and mapped each package to its GitHub repository. Renames were resolved through the GitHub API. Repositories that were archived (17 packages, including `node-sass`, `tslint`, `cross-env`, and several webpack loaders) were skipped. Many top packages share a repository: 15 Babel packages map to `babel/babel` and 7 `@types/*` packages to DefinitelyTyped. Each repository was kept once, credited to its highest-ranked package. Reaching 100 unique repositories took the top 153 packages.

**Scope.** CloneProof checks the repository **root**, the way a contributor sees it after `git clone`. For monorepos, the published package lives in a sub-folder, so results describe "setting up this repository", not "installing this package". The check is static: one isolated shallow clone per repository, no `npm install`, no test run, no repository code executed.

**Pre-registration.** The selection procedure, the sample with expected findings, the procedure, and the judging rules were [committed and pushed](https://github.com/psuvraneel-cyber/Clone-Proof/commit/c382a2ff5f4ac4399a5f4817ee68f8f8fa7a3534) before any check ran. The judging rules are the ones we used for an earlier random-sample run, unchanged.

**Judging.** Every warning and failure was judged by reading the repository at the checked commit:

- **real**: true, and it matters to someone setting up this repository root;
- **policy**: true, but a choice a reasonable maintainer makes on purpose (for example, a library that does not commit a lockfile);
- **false**: wrong.

**Disclosure.** All judgments were made by an AI assistant (Claude), which also helped build CloneProof, and they were not blind to the tool's output. Each judgment has a one-line reason with file and line references, so anyone can re-judge. Where the rules were ambiguous, the interpretation was written down once and applied everywhere; we also report how the numbers change under the stricter reading.

## Results

| Report status | Repositories |
|---|---:|
| Passed | 31 |
| Passed with warnings | 56 |
| Failed (exit 1, would fail a CI gate) | 6 |
| Blocked by safety limits (exit 2) | 7 |

| Findings | Total | Real | Policy | False |
|---|---:|---:|---:|---:|
| Blocking (failed) | 10 | 1 | 0 | 9 |
| Warnings | 73 | 10 | 46 | 17 |

### What was real

**Tests that need a browser (6 repositories).** In `chai`, `axios`, `vuejs/core`, `karma`, `debug`, and `karma-chrome-launcher`, `npm test` starts a real browser through Playwright, Karma, or web-test-runner. That is a deliberate choice and a good one, but someone running `npm test` on a fresh machine or in a minimal container needs a browser installed first. Two examples:

- `axios`: `npm test` runs `vitest run` ([package.json:122-123](https://github.com/axios/axios/blob/9d11464a75ee5c644c0308d742f58755c0482594/package.json#L122-L123)), and the Vitest config includes browser projects with `browser.enabled: true` ([vitest.config.js:16-41](https://github.com/axios/axios/blob/9d11464a75ee5c644c0308d742f58755c0482594/vitest.config.js#L16-L41)).
- `vuejs/core`: `npm test` runs `vitest` ([package.json:19](https://github.com/vuejs/core/blob/24c9d0bffb2299635b8112a978d74a38723aaa10/package.json#L19)), which includes an `e2e-browser` project using Playwright Chromium ([vitest.config.ts:104-116](https://github.com/vuejs/core/blob/24c9d0bffb2299635b8112a978d74a38723aaa10/vitest.config.ts#L104-L116)).
- `chai`: `npm test` ends with `test-chrome`, which runs `web-test-runner --playwright` ([package.json:39-41](https://github.com/chaijs/chai/blob/8cd999c735f025102a4294217309650f60d8cf96/package.json#L39-L41)).

**Workspace roots without a root test script (3 repositories).** `tslib`, `rollup/plugins`, and `rxjs` have test suites, but `npm test` at the root does not run them. Contributors have to know the per-package or task-runner command. For example, `tslib` keeps its tests in `test/` with a `runTests.js` driver, and the root [package.json](https://github.com/microsoft/tslib/blob/8d6f9cdef0a24dc4f730815497a14cfbd79adec7/package.json) defines no scripts.

**A stale lockfile (1 repository, the only real build-failing finding).** `less/less.js` uses pnpm. Its `package.json` declares `packageManager: pnpm` and a `postinstall` of `npx only-allow pnpm`, and it commits `pnpm-lock.yaml`. It also still commits a `package-lock.json` that lacks three root devDependencies declared at [package.json:33-36](https://github.com/less/less.js/blob/713331655e437401dfea6cd233893a69762734e1/package.json#L33-L36), so `npm ci` refuses to install. pnpm users never notice; anyone whose tooling sees `package-lock.json` and reaches for npm does.

### What was policy, not breakage

The most common finding by far was **no committed lockfile: 29 repositories**, all of them libraries published to npm under the same name (`eslint`, `express`, `chalk`, `debug`, `semver`, and others). Many library maintainers deliberately leave lockfiles out so their tests run against the dependency ranges users actually get. It is a reproducibility trade-off, not a mistake, and we count it as policy.

Similarly, 17 environment-variable warnings point at real but optional switches: debug flags like `PRETTIER_DEBUG`, `TS_JEST_LOG`, or `HUSKY=0`. Nobody needs to set them to clone and test the project.

Of the 6 repositories that would have failed a CI gate, 5 failed only because of false findings. "Six top packages fail a fresh-clone check" would be a misleading headline, and we are not writing it.

### The landscape

- **Lockfiles at the root:** 42 npm only, 14 pnpm, 13 Yarn, 1 npm and pnpm together, 0 Bun, 30 none.
- **`packageManager`:** declared by 29 repositories (14 Yarn, 12 pnpm, 3 npm).
- **Node.js version:** 68 declare `engines.node`; 8 commit `.nvmrc` and 5 `.node-version`. No real runtime disagreement was found.
- **README commands:** no README told contributors to run a script that does not exist. Every README finding was a false alarm (below).

## What CloneProof got wrong

This is the part we learned the most from. **26 of 83 findings were false.**

1. **README examples for users (9 blocking findings, 5 repositories).** `webpack-dev-server`, `lint-staged`, `nyc`, `coveralls`, and `gh-pages` all document how to add a script to *your* project and run it. For example, `gh-pages` shows a `"deploy": "gh-pages -d dist"` script and then `npm run deploy` ([readme.md:373-384](https://github.com/tschaub/gh-pages/blob/48f62a750216e72c5e89058bb61dffdb8450949d/readme.md#L373-L384)), and `nyc` shows a whole example `scripts` block ([README.md:337-345](https://github.com/istanbuljs/nyc/blob/908620475199fa7b9ea0ea8b21d6d8ad6921e3ae/README.md#L337-L345)). CloneProof read those as instructions for the repository itself and failed the build. In our earlier random sample of mostly applications, the same check was right; on libraries, whose READMEs are written for consumers, it was wrong every time. Fix: ignore script references whose script is defined in a README code block, and treat consumer-usage sections as such.
2. **Environment variables the user never sets (14 warnings).** CloneProof reported `GIT_DIR` (set by Git during hooks), `HOMEPATH` and `PROGRAMFILES` (set by Windows), `COMP_CWORD` (set by the shell), CI-service variables, and keys a tool sets for itself, such as `WEBPACK_SERVE` and `ROLLUP_WATCH`, as undocumented configuration. Two were plain bugs: `process.env.Wimp$ScrapDir` in shelljs ([src/tempdir.js:48](https://github.com/shelljs/shelljs/blob/060e8ac15aa32b1311db15c5e12cd64016637932/src/tempdir.js#L48)) was parsed as a key named `Wimp`, and PostCSS was flagged for a variable mentioned only in a doc comment ([lib/css-syntax-error.d.ts:226](https://github.com/postcss/postcss/blob/2455ac8212fe66bc3248aa01186a52c27c87da5a/lib/css-syntax-error.d.ts#L226)).
3. **"No tests" when the tests are not JavaScript (2 warnings).** `husky` tests with shell scripts and `dart-sass` with Dart; CloneProof only looked for JavaScript test files.
4. **A Node version mismatch that is not one (1 warning).** `semantic-release` pins `.nvmrc` to `24`, which nvm resolves to the latest 24.x. CloneProof compared `24.0.0` against `>= 24.10.0`.

Under a stricter reading of the environment rule (a finding is false only when *every* key it lists is wrong), 6 environment warnings are false instead of 14, and warning correctness rises from 76.7% to 87.7%. The blocking result does not change.

None of these are fixed in the version we measured (v0.2.0). They are now the top of the backlog, and the fix will be measured by re-running this exact sample with the same judgments.

## Limitations

- **Root only.** Monorepo packages are judged as part of their repository, not as published packages.
- **Static only.** Nothing was installed or run, so this cannot tell you whether the tests actually pass on a fresh machine. CloneProof's optional Docker `verify` mode does that, and was not used here.
- **Not a typical sample.** These are the most-depended-on, most-maintained repositories in the ecosystem. Our earlier random sample of 50 smaller repositories looked different: 12 of 50 failed because they had no test script.
- **Repositories move.** Results are pinned to commits from 2026-10-30; all 93 checked commits matched the sampled ones.
- **One AI judge, not blind.** The reasons are public, so please re-judge anything you disagree with.
- **7 repositories were not checked** because of CloneProof's clone safety limits.

## Try it

Check any public repository without installing anything:

```bash
npx github:psuvraneel-cyber/Clone-Proof#v0.2.0 check https://github.com/OWNER/REPO
```

Or add it to CI with the GitHub Action ([CloneProof Check on the Marketplace](https://github.com/marketplace/actions/cloneproof-check)):

```yaml
- uses: psuvraneel-cyber/Clone-Proof@v0.2.0
```

## How to reproduce

Everything is in the repository:

- `docs/field-test/run6-ranking.json`: the ranking snapshot;
- `docs/field-test/run6-sample.json`: the 100 repositories, their commits, and the expected findings;
- `docs/field-test/run6-results.json`: every finding;
- `docs/field-test/run6-judgments.json`: every judgment, its reason, and the interpretations used.

The full write-up, with intervals and per-code tables, is in [docs/FIELD_TEST.md](../FIELD_TEST.md#run-6-results). To rebuild the sample and rerun the checks:

```bash
node scripts/fieldtest.js ranking --pages 5 --out ranking.json
node scripts/fieldtest.js sample-list --ranking ranking.json --count 100 --out sample.json
node scripts/fieldtest.js run --sample docs/field-test/run6-sample.json --out results.json
node scripts/fieldtest.js summary --results docs/field-test/run6-results.json --judgments docs/field-test/run6-judgments.json --sample docs/field-test/run6-sample.json
```

The ranking changes over time, so a fresh `ranking` run gives a slightly different sample; the committed files reproduce the published tables exactly.

Thanks to the maintainers of all 100 projects. Nothing here is a criticism of their work. If CloneProof flagged your project and you think it is wrong, you are probably right; please [open an issue](https://github.com/psuvraneel-cyber/Clone-Proof/issues).
