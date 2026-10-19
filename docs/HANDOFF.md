# CloneProof handoff

Updated 2026-10-20; the current local baseline is `507df21`, with the requested independent test-pass fixes in `1fd2020`, `9aef27f`, and `1370967`. Local `main` is ahead of `origin/main`; no CI receipt exists yet for these local commits. Separate follow-on commits `c797cbd`, `4495268`, and `507df21` add verification, bounded-path-suggestion, and CI cleanup work outside the requested three-fix pass. The preceding pushed revision `a762ec1` passed main CI run `39289281815` on Ubuntu, macOS, Windows, and Docker E2E. This file records the current resumable state for the OmniRush session.

## Goal

Deliver a reproducible, secure-by-design CLI for Node.js/TypeScript repository setup verification. `check` never executes repository code: local targets are read-only scans and GitHub targets use one isolated shallow clone before scanning. `verify` runs only the supported npm workflow inside an explicitly authorized, bounded Docker profile.

## State

### Working

- `check <path-or-github-url>` emits deterministic text, canonical JSON, or self-contained HTML reports with relative paths and no timestamps or absolute target paths.
- Local scans honor root `.gitignore` and a bounded regular `.git/info/exclude`; ignored directories are skipped, and ignored core files receive `CORE_FILE_GITIGNORED` warnings. GitHub checkouts pass `freshClone: true` and skip local-ignore behavior.
- Static checks cover package metadata, npm/pnpm/Yarn lockfiles, scripts, README commands, environment references and templates, runtime declarations, Dockerfile Node versions, bounded traversal, nested-package boundaries, symlinks, and deterministic SHA-256 snapshots.
- Environment destructuring uses a bounded brace scanner that handles aliases, defaults, quoted keys, nested patterns, multiline assignments, and direct `process.env`/`import.meta.env` access.
- Project classification checks a root package manifest first, then other-ecosystem markers, then supported root/application source locations.
- Partial `.nvmrc`, `.node-version`, and Docker Node pins use prefix/existential engine-range semantics; full versions retain exact comparison.
- Partial `>` engine ranges follow npm release semantics: `>X` is treated as `>=X+1.0.0` and `>X.Y` as `>=X.Y+1.0`.
- GitHub input accepts canonical public repository roots from `github.com` or `www.github.com`, strips trailing query/fragment data, and rejects `/tree/<ref>` and `/blob/...` paths with a deterministic canonical-root message. Non-existing local paths ending in `owner/repo` remain local and receive a GitHub suggestion without changing `target.name`. The ten-second public visibility/size preflight blocks repositories over `MAX_REPOSITORY_BYTES` (4 GiB), private repositories, and missing repositories before cloning; the GitHub `size` value and `target.repositorySizeKb` describe full history, not the shallow checkout. `target.preflightReason` uses fixed values for checked, HTTP, rate-limit, timeout, network, invalid-response, and no-fetch outcomes. A configured token rejected with 401 is retried exactly once without authorization; the safe notice and `preflightTokenRejected` diagnostic never expose its value, and successful fallback metadata records `preflightAuthenticated: false`.
- GitHub cloning resolves a trusted absolute Git executable, uses an allow-listed environment and empty Git config, disables credential helpers/LFS smudging, uses no shell, records `100755` and `120000` paths with `git ls-files -s -z` before deleting `.git`, and cleans its parent directory on success and failure. Cleanup retries ten times at 100 ms and reports only a temporary-folder basename if a Windows file lock persists.
- GitHub checkout limits are enforced before the non-fatal Git mode read. Limit failures identify the specific bound, configured value, reached count, and deterministic relative stop path while retaining numeric `limit`/`path` metadata. `parseGitFileModes` returns sorted `executablePaths` and `symlinkPaths`; NUL-delimited parsing preserves paths with spaces and non-English characters. `target.commit` records a valid 40-character `rev-parse HEAD` result when available, and `target.executableModes` records `checked` or `unavailable`. Git-listed symlinks skip static reads and block Docker staging consistently on every OS.
- Docker verification uses the pinned image `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`, `--pull=never`, a read-only source mount, non-root UID/GID 1000, dropped capabilities, no-new-privileges, no network by default, and bounded CPU/memory/PID/tmpfs/output/time policies.
- Docker staging honors the root `.gitignore` and root `.git/info/exclude` for local targets, keeps ignored core files, reports skipped ignored paths, and does not read nested `.gitignore` files. Ignored-path findings are informational/skipped, evidence is capped at 50, and verification metadata is capped at 500 paths with `ignoredPathCount` and `ignoredPathsTruncated`. GitHub fresh clones copy committed sensitive fixtures; local staging still omits them and reports `DOCKER_SENSITIVE_FILES_OMITTED`. The project `.dockerignore` separately keeps credential-like files out of CloneProof's own image build context. Command-line `npm ci --ignore-scripts` remains authoritative.
- Static npm checks add informational/skipped `INSTALL_SCRIPTS_SKIPPED` and advisory `BROWSER_TESTS_DETECTED` findings. Test-phase Docker failures include targeted explanations when either limitation is present; install scripts and browsers remain disabled/not installed.
- Every verification return is finalized through summary/cleanup normalization. `report.summary` matches `findings` on consent, prerequisite, network, Docker/image, symlink, staging-limit, source-change, execution, timeout, and cleanup paths.
- Text and HTML verification output explain omitted lines and character shortening; HTML badges are static and contain no `role="status"`.
- Schema version 2 reports now include additive `coverage.checked` and `coverage.notChecked` fields, with renderer explanations for what was and was not checked. Coverage includes package sources, build output, and service indicators, with a centralized finding/group consistency map.
- Environment warnings exclude documented tooling/example/fixture/config scopes and conventional process variables, including both cases of proxy variables.
- README checks recognize npm install aliases, start/server.js behavior, package-manager setup mismatches, and script aliases without executing README commands. Commands after `cd` into another project are summarized by `README_OTHER_PROJECT_COMMANDS`; unknown repository `npm start` is `README_START_COMMAND_UNKNOWN`.
- Root `.npmrc` and dependency metadata use host-only findings: public Git hosts produce `GIT_DEPENDENCIES`, while non-public hosts produce `PRIVATE_REGISTRY`; a gitignored personal `.npmrc` is exempt from the core-file warning.
- `cloneproof setup` prepares the exact pinned verifier image through an isolated Docker client. Optional `CLONEPROOF_GITHUB_TOKEN`/`GITHUB_TOKEN` authentication is limited to the size preflight and records only `target.preflightAuthenticated`.
- Skipped/info `BUILD_OUTPUT_MISSING` and `SERVICES_LIKELY_REQUIRED` cover build-output references and common service indicators without running builds or services.
- Local `check` resolves the target before traversal and immediately blocks home folders and filesystem roots with `WRONG_TARGET`; the home value is injectable in tests and no directory walk occurs for this finding.
- Bounded scans report `SCAN_ENTRY_LIMIT_EXCEEDED` with a relative stop path and the configured limit. Every scanner, GitHub checkout inspector, and Docker staging walker processes sorted files before sorted subdirectories.
- Unsupported roots stop after classification. They emit only `UNSUPPORTED_ROOT`/`EMPTY_REPOSITORY`, nested-package, scan-limit, and read-error findings; coverage matches those attempted groups and no Node package checks run.
- Text and HTML render at most ten evidence entries per finding with a JSON pointer. `ENV_CHECK_SKIPPED` JSON evidence is capped at 50 with its total in the message, and nested-package messages show the count plus five paths.
- npm packaging now whitelists `src/`, `README.md`, and `LICENSE`; CI checks `npm pack --dry-run --json`, installs the archive globally in all three matrix operating systems, and runs `cloneproof --help`. `cloneproof --version` reports package.json's version.
- CI also installs the commit-specific GitHub archive from `https://github.com/psuvraneel-cyber/Clone-Proof/archive/${{ github.sha }}.tar.gz` with `npm install --global` on Ubuntu, macOS, and Windows, then requires `cloneproof --version` to exit `0`.

### Remaining gaps

- The symlink integration test is skipped on this Windows host because symlink creation returned `EPERM`; Git-listed mode `120000` handling and the Docker staging path are covered with injected results. Local `core.symlinks=false` checkouts cannot be recognized without Git metadata, and container symlink recreation is out of scope.
- `make test` was not run because `make` is unavailable on this Windows host; `npm test` is the portable command and the Makefile remains for Linux.
- GitHub preflight authentication is optional and still subject to rate limits; the token is never passed to Git or Docker, and unavailable preflight continues with bounded clone limits.
- Docker verification remains an opt-in reproducibility experiment, not a complete hostile-code sandbox. `--allow-network` enables network for both install and test and should be used only for trusted repositories.
- Dynamic execution supports only the root npm/Node workflow. pnpm/Yarn profiles, external service health, OS-specific scripts, and custom setup remain outside the execution profile.
- Final Run 3 results are recorded in `docs/FIELD_TEST.md`: 15 public repositories, 13 correct and 2 environment-limited failures, warning precision 83.3%, combined warning/failure precision 83.3%, and static planted-bug detection of 13/13 offline plus 39/39 in the separate network-dependent real-repository procedure.
- The Windows host still skips the real symlink-creation test because it returns `EPERM`; Linux CI is required to run it.
- Remaining user-facing follow-ups are the Buildathon dashboard submission, demo video, and Submission ID in Unstop. Main CI run `39289281815` passed all four jobs for the preceding pushed revision; the independent test-pass commits listed below remain local pending push and CI.

## Important files

- `src/cli.js` — argument parsing, GitHub/local target handling and suggestions, output files, exit codes, and source metadata.
- `src/input/github.js` — URL validation, API preflight, trusted Git clone invocation, bounded checkout inspection, and cleanup.
- `src/util/executable.js` — trusted absolute Git and Docker executable discovery.
- `src/scan/repository.js` — deterministic scanner, bounded environment parser, project classification, Gitignore matcher, and findings.
- `src/report/render.js` — canonical JSON, color-safe text, escaped self-contained HTML, bounded-output indicators, and exit-code mapping.
- `src/verify/docker.js` — pinned Docker profile, staging, limits, cleanup, redaction, and verification summary finalization.
- `src/report/coverage.js` — stable check-group IDs, labels, and not-checked scope.
- `test/github.test.js` — URL, preflight, Git isolation, trusted executable, cleanup, and network-free clone tests.
- `test/scan.test.js` — scanner, environment, classification, Gitignore, runtime, bounds, and non-execution tests.
- `test/planted-bugs.test.js` — offline realistic base and 13 one-change mutations.
- `scripts/planted-bugs-real.js` — repeatable read-only real-repository planted-bug procedure.
- `test/report.test.js` — canonical renderers, escaping, output bounds, static badges, and exit codes.
- `test/verify.test.js` — Docker arguments, injected runner, every summary path, staging, cleanup, phases, and timeout behavior.
- `test/cli.test.js` — CLI reports, URL forms, output formats, nested output folders, and exit codes.
- `Dockerfile`, `.dockerignore`, `.nvmrc`, `package-lock.json`, `Makefile`, `.env.example` — clean rebuild artifacts.
- `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, `docs/DECISIONS.md`, `docs/FIELD_TEST.md`, `docs/BUILDATHON_CHECKLIST.md` — trust boundary, usage, decisions, field evidence, and submission evidence.

## Field-test-fix changes and fields

- `src/input/github.js`: `MAX_REPOSITORY_BYTES = 4 * 1024 * 1024 * 1024`; oversized messages identify the GitHub full-history size and 4 GiB sanity bound; `parseGitFileModes` returns sorted `executablePaths` and `symlinkPaths`.
- `src/input/github.js` / `src/cli.js`: GitHub source metadata now carries `symlinkPaths` alongside `executablePaths`; `target.repositorySizeKb`, `target.commit`, and `target.executableModes` remain relative, deterministic report metadata.
- `src/scan/repository.js`: `scanRepository` accepts Git-listed symlink paths and skips them like `lstat` symlinks; `INSTALL_SCRIPTS_SKIPPED` is `skipped`/`info`.
- `src/verify/docker.js`: `stageRepository` skips Git-listed symlinks and copies sensitive files only for `freshClone: true`; `DOCKER_SYMLINKS_BLOCKED` evidence is capped at 50 with the total in its message; local sensitive omissions remain warnings.
- `src/scan/repository.js`: environment-warning path filters, README setup parsing, `PRIVATE_REGISTRY`, build-output references, and service indicators are deterministic and host-only.
- `src/verify/docker.js` / `src/cli.js`: `cloneproof setup` probes, pulls, and confirms the pinned image without changing verify's `--pull=never` policy.
- `src/input/github.js`: optional preflight-only Bearer token handling records a boolean authentication state and redacts fetch diagnostics.
- `test/planted-bugs.test.js`: offline detection is 13/13; the documented real-repository extension detected 39/39 cases, including three whitespace-only README controls.
- `docs/FIELD_TEST.md`: the pre-run expectations, original first-run columns, fixed verdicts, 16 rerun invocations, workflow evidence, counted summaries, and current limitations are recorded. React's rerun measured 7,260 checkout files and 41,784,802 checkout bytes (~39.85 MiB) against the 1,119,361 KiB full-history API value.

## Independent test-pass fixes (2026-10-20)

- `1fd2020 fix: accept safe GitHub URL variants` updates `src/input/github.js`, `src/cli.js`, `test/github.test.js`, and `test/cli.test.js`. Safe public GitHub roots are canonicalized; tree/blob links are rejected with the canonical root; missing local `owner/repo` paths remain local and receive deterministic suggestions.
- `9aef27f fix: retry GitHub preflight after token rejection` updates `src/input/github.js`, `src/cli.js`, `test/github.test.js`, and `test/cli.test.js`. A configured-token 401 gets one unauthenticated retry, checked fallback metadata reports `preflightAuthenticated: false`, and only a boolean rejection diagnostic crosses into reports.
- `1370967 fix: explain GitHub checkout limits` updates `src/input/github.js` and `test/github.test.js`. All checkout bounds identify their configured limit and reached count at the relative stop path while preserving existing limit/path metadata.
- Separate follow-ons: `c797cbd fix: preserve zero-test evidence`, `4495268 fix: bound GitHub path suggestions`, and `507df21 fix: repeat Windows cleanup in CI`; these are outside the requested three-fix pass.
- This pass intentionally changed no credentials, tokens, absolute machine paths, protected security/decision documentation, README, CI configuration, or unrelated files. Separate committed follow-ons `c797cbd`, `4495268`, and `507df21` changed verification behavior, GitHub path-suggestion bounds, and `.github/workflows/ci.yml` after the requested three-fix commits.

## Decisions to preserve

- Keep static inspection separate from execution. Never run repository scripts, README commands, lifecycle hooks, or target Dockerfiles.
- For local `check`, start no process. For GitHub `check`, run only the isolated CloneProof-owned Git clone before the read-only scan.
- Keep the first dynamic profile npm-only: `npm ci --ignore-scripts`, then the declared `npm test`, inside the pinned controlled image.
- Require `--docker --execute`; keep `--network=none` unless `--allow-network` is explicitly supplied.
- Do not trust target Dockerfiles, accept arbitrary Docker flags, mount the Docker socket, pass host secrets, inherit host Git config/credentials, or silently enable network access.
- Keep report fields relative, sorted, canonical, bounded, and free of timestamps.

## Current checks for independent test-pass fixes (`1370967`)

- Focused GitHub/CLI tests after issue 8 — passed: 44 tests, 44 passed, 0 failed.
- Focused GitHub/CLI tests after issue 9 — passed: 48 tests, 48 passed, 0 failed.
- Focused GitHub tests after issue 10 — passed: 33 tests, 33 passed, 0 failed.
- Final `npm test` at `1370967` — passed: build checked 8 source files; 213 tests, 212 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- `git diff --check` — passed. No Docker or CI run was needed for these offline changes; the latest CI receipt remains `39289281815` for `a762ec1`.
- Current `npm test` at `507df21` — passed: 216 tests, 215 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip. The separate verification and bounded-suggestion follow-ons are covered by their added tests; the CI cleanup change has not yet received a remote CI receipt.

## Historical checks observed

- `npm test` before this change set — passed: 165 tests, 164 passed, 1 skipped on the Windows host; the skip is the expected symlink `EPERM` case.
- `git diff --check` — passed.
- `docker image inspect node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` — passed after confirming/pulling the recorded digest.
- `docker build -t cloneproof .` — passed after the four fixes and report corrections.
- `docker run --rm --network none cloneproof` — passed, exit `0`.
- `docker run --rm --network none cloneproof npm test` — passed, exit `0`, 130 tests passed and 0 skipped in the Linux container.
- `node src/cli.js verify examples/healthy-node --docker --execute` — passed, exit `0`, network `none`, cleanup confirmed.
- `node src/cli.js verify examples/broken-node --docker --execute` — blocked as intended, exit `2`, no target container started.
- `node src/cli.js check examples/healthy-node` — passed, exit `0`.
- `node src/cli.js check examples/broken-node` — failed as intended, exit `1`.
- `node src/cli.js check . --format json` — passed; nested-package evidence contains only the two demo packages, not `.claude/worktrees` or `.opencode`.
- Reproduction A — fixed: `ENV_EXAMPLE_MISSING` reports `DATABASE_URL, PORT`, never `join` or `resolve`.
- Reproduction B — fixed: status `blocked`, exit `2`, `UNSUPPORTED_ROOT` identifies Python and `requirements.txt`.
- Reproduction C — fixed: no `ENGINES_NODE_UNSATISFIED` for `.nvmrc`/Docker Node `22` versus `>=22.19.0`.
- Reproduction D — fixed: `findings=11`, `summary.total=11`, `skipped findings=1`, `summary.skipped=1`.
- Reproduction E — fixed: isolated Git config listing showed only `command line:` entries for credential/filter policy; no host credential helper, LFS filter, sentinel, or askpass variable.
- Reproduction F — fixed: local scan retained `LOCKFILE_PRESENT` and added `CORE_FILE_GITIGNORED` for `package-lock.json`.
- Real Express fixture with `npm install --package-lock-only --ignore-scripts` — no-network verify blocked with `DOCKER_NETWORK_REQUIRED`, exit `2`; `--allow-network` passed, exit `0`.
- Real Jest fixture using package.json `"test": "jest"` — passed with `--allow-network`, exit `0` after the workspace tmpfs was changed to `exec`; no resource-limit adjustment was needed.
- Failing test fixture — failed with `failedPhase: test`; explicit stderr was visible as separate lines in text and HTML renderers.
- Hanging test fixture with `--timeout-ms 15000` — failed and timed out, cleanup confirmed; `docker ps -a --filter name=cloneproof-verify` showed no containers.
- `node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json` — passed, exit `0`, preflight `checked`, repository size `150 KiB`, clone cleaned.
- `node src/cli.js verify https://github.com/psuvraneel-cyber/Clone-Proof --docker --execute --format json` — passed, exit `0`, preflight `checked`, container exit `0`, cleanup confirmed.
- Final GitHub verification with `--allow-network` — passed, exit `0`; preflight `checked`, container exit `0`, `verification.ignoredPaths: []`, and cleanup confirmed.
- A random nonexistent public GitHub URL — blocked with `GITHUB_REPOSITORY_UNAVAILABLE`, exit `2`, no sign-in prompt.
- Two JSON checks of the same fixture with `--output` — byte-identical.
- Temporary-folder audit after the reruns — no `cloneproof-*` temporary directories remained; `docker ps -a --filter name=cloneproof-verify` returned no containers.
- Field test — 15 public repositories run with check/no-network/network-allowed modes where applicable; no CloneProof temporary folders or `cloneproof-verify` containers remained. Full results, target commits, exit codes, durations, and verdicts are in `docs/FIELD_TEST.md`.
- Field-test fix `cb44146` — `INSTALL_SCRIPTS_SKIPPED` names npm lockfile packages whose install scripts are intentionally skipped; native test-phase failures explain the likely cause.
- Field-test fix `8ca4fc3` — `BROWSER_TESTS_DETECTED` identifies browser tooling reachable from the test script; browser test-phase failures explain that the controlled image has no browser executable.
- Field-test fix `a8d1dc1` — the GitHub full-history sanity limit is 4 GiB, with exact-boundary tests and a measured React shallow checkout of 7,260 files / 41,784,802 bytes.
- Field-test fix `cf02646` — Git-listed mode `120000` symlinks propagate through check and verify; Commander now blocks with `DOCKER_SYMLINKS_BLOCKED` on Windows as it would on Linux.
- Field-test fix `22e0258` — fresh public GitHub clones stage committed sensitive fixtures while local folders retain omission protection.
- Field-test fix `aeea9ac` — `INSTALL_SCRIPTS_SKIPPED` is informational/skipped and no longer downgrades an otherwise healthy check.
- Field-test docs `2a35843` — rerun expectations were recorded before the affected repository commands.
- Pre-submit implementation commits: `0b99b43`, `4926d4d`, `510c407`, `28dcc0d`, `59ec879`, `9c435aa`, `9929395`, `dbb3841`.
- Field-test swap — `microsoft/TypeScript-Node-Starter` was unavailable from read-only `git ls-remote`; `typeorm/typeorm` was used as the documented TypeScript/external-service replacement.
- Previous post-push check against `main` at `d57a465` — passed, exit `0`, target commit `d57a465e73e8`, complete scan, status `passed`; GitHub preflight was `unavailable` (the unauthenticated API limit), and the clone was cleaned.
- Post-push check against `main` at `4c0900e` — passed, exit `0`, target commit `4c0900eb03fcb4f38e00486b4ef276fd40d30`, preflight `checked`, repository size `150 KiB`, complete scan, status `passed`, 10 passed / 1 skipped / 0 failed; the clone was cleaned and the temp/container audit was empty. Later history includes both documentation and implementation fixes; the current baseline is recorded at the top of this handoff.

## Final gap-closure checks

- `npm test` before the target-guard changes — passed: 165 tests, 164 passed, 1 skipped on Windows; the skip is the expected symlink `EPERM` case.
- `npm test` after the target-guard changes and optional version/install work — passed: 174 tests, 173 passed, 1 skipped on Windows; the skip is the expected symlink `EPERM` case.
- `git diff --check` — passed.
- `docker build -t cloneproof .` — passed using the pinned base image.
- `docker run --rm --network none cloneproof npm test` — passed: 165 tests, 165 passed, 0 skipped in Linux.
- `node src/cli.js setup` — passed; the exact verifier image was already present and no pull was needed.
- `node src/cli.js verify examples/healthy-node --docker --execute --format json` — passed, exit `0`, network `none`, cleanup complete.
- `node src/cli.js verify examples/broken-node --docker --execute --format json` — blocked, exit `2`, `DOCKER_PREREQUISITES_FAILED`, no target container started.
- Current local verification — `npm test` passed with 193 tests, 192 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip; `docker build -t cloneproof .` passed; `docker run --rm --network none cloneproof npm test` passed with 193 tests, 192 passed, 0 failed, and 1 skipped; and the default `docker run --rm --network none cloneproof` smoke run passed. A live Windows process-level SIGINT reproduction exited with `SIGINT` and left zero matching `cloneproof-verify-*` containers; the final Docker cleanup audit also returned no `cloneproof-verify-*` or `cloneproof-github-*` containers.
- From the user's home directory, `npx --yes github:psuvraneel-cyber/Clone-Proof#target-guard-fixes check .` exited `2` immediately with one `WRONG_TARGET` finding and no traversal output.
- Target branch CI run `39036000461` — passed on Ubuntu, macOS, Windows, and Docker E2E; pack-content and global packed-CLI smoke steps passed.
- `node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json` after the final implementation push — passed, exit `0`, `target.commit: 1b919eccaa43804addbc2fe47ba61e962862724a`, preflight `checked`, authenticated `false`, 10 checked groups, 10 passed / 1 skipped / 0 failed.
- The preflight-redaction regression test covers a token-bearing GitHub API error: reports and stderr contain only `[REDACTED]`.
- Pre-submit CI run `39028051301` and main CI run `39028381054` — passed for implementation revision `1b919ec`; later history includes additional implementation fixes that need a subsequent CI run.
- Main CI run `39289281815` — passed for pushed revision `a762ec1`; Docker E2E and Ubuntu, macOS, and Windows package/archive smoke checks all passed.
- Docker/container cleanup audit after the final checks — no `cloneproof-verify` containers and no CloneProof GitHub clone directories remained.

## Historical final submission checks (`ec026ef`)

- Windows `npm test` — passed: 189 tests, 188 passed, 1 expected symlink `EPERM` skip; `git diff --check` passed.
- Ten exact Windows `npm test` repetitions — all exited `0`; `cloneproof-*` directory count was 0 before and 0 after, with 0 new directories.
- Plain Jest fixture verification — passed with explicit `--allow-network`, exit `0`, pinned image, and cleanup complete.
- Branch CI `39119108657` — passed on Ubuntu, macOS, Windows, and Docker E2E for `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`.
- Main CI `39119180819` — passed on Ubuntu, macOS, Windows, and Docker E2E for `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`.
- Final GitHub check against pushed `main` — passed, exit `0`, target commit `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`, preflight `checked`, repository size `401 KiB`, complete scan, 11 passed / 1 skipped / 0 failed.
- Final cleanup audit — no `cloneproof-*` directories in the Windows temp directory and no containers matching `cloneproof-verify`.

## Previous handoff refresh

- At the start of this refresh, local `main` matched `origin/main` at `e0de5cf` and the working tree was clean.
- `npm test` — passed in this session: build checked 7 source files; 189 tests, 188 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- `git diff --check` — passed after this documentation-only edit; Git emitted only the normal Windows LF/CRLF normalization warning.
- No source, test, package, Docker, or workflow behavior changed in this refresh; only this handoff document was updated.

## Final documentation submission refresh

- `docs-final` started from the local `main` baseline and was pushed at `1d817e726877c69e6af3fc295b3bb2c559eaf027`. The branch was then fast-forwarded into `main`; before this handoff-only update, local `main`, `origin/main`, and `origin/docs-final` all pointed to that revision.
- `5135653` updates the README install section to use the GitHub `main.tar.gz` archive, documents `npx github:psuvraneel-cyber/Clone-Proof check <project-folder>`, preserves the unrelated-package warning, and keeps the project-folder note.
- `4c2ae26` removes the superseded target-guard recheck claims from the README and handoff and replaces the detailed `FIELD_TEST.md` recheck with the requested short paragraph.
- `a4f19f2` repairs `docs/FIELD_TEST.md`: earlier runs are clearly labeled, Run 3 follows them, and the five known limitations now appear at the end of the file.
- `1d817e7` adds the commit-specific GitHub archive install/version smoke step to the Ubuntu, macOS, and Windows test matrix.
- Changed paths in this documentation pass: `README.md`, `docs/FIELD_TEST.md`, `docs/HANDOFF.md`, and `.github/workflows/ci.yml`; no `src/` or test files changed.
- `npm test` — passed in this session after each working change: build checked 7 source files; 189 tests, 188 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- `git diff --check` — passed after each working change; Git emitted only the normal Windows LF/CRLF normalization warning.
- Branch CI `39247229775` — passed on Ubuntu, macOS, Windows, and Docker E2E. The new archive install step passed on all three operating systems.
- Main CI `39247368837` — passed on Ubuntu, macOS, Windows, and Docker E2E. The new archive install step passed on all three operating systems.
- The final README install command is `npm install -g https://github.com/psuvraneel-cyber/Clone-Proof/archive/refs/heads/main.tar.gz`; the documented no-install command is `npx github:psuvraneel-cyber/Clone-Proof check <project-folder>`.

## Commits in this review pass

- `1370967 fix: explain GitHub checkout limits`
- `9aef27f fix: retry GitHub preflight after token rejection`
- `1fd2020 fix: accept safe GitHub URL variants`

- `2e308e8 fix: explain scan entry limits`
- `79d7b68 fix: prioritize root files during scans`
- `0c3a6bd chore: harden npm package publishing`
- `dd0db05 fix: bound rendered evidence lists`
- `721bad1 fix: block home and root targets`
- `e4e3170 fix: gate checks for unsupported roots`
- `d9caefb feat: add version and install guidance`

- `bdde31b fix: isolate GitHub clone configuration`
- `4fa17f0 fix: resolve Git from trusted paths`
- `0bb7a4f fix: bound environment destructuring scans`
- `e676e4c fix: classify non-Node repositories before source guesses`
- `4bde0e1 fix: handle partial Node engine pins`
- `15543fb fix: finalize verification summaries`
- `9ccee28 feat: preflight GitHub repositories`
- `98a96f4 fix: honor local Git ignore rules`
- `41e9c3f fix: reject ambiguous GitHub targets`
- `36b2235 fix: support report output files`
- `8a03c73 fix: parse exported environment templates`
- `930071a fix: explain truncated verification output`
- `8d82af7 fix: keep HTML badges static`
- `746bbef fix: report bounded scan edge cases`
- `89ba216 docs: fix example commands`
- `f0048dc docs: align static and GitHub modes`
- `d4221e6 docs: keep demo reports ignored`
- `dceb3dc fix: pin verifier image by digest`
- `984e94e fix: treat ignored Docker paths as informational`
- `2d435b0 fix: bound Git executable mode inspection`
- `f5d15f9 feat: record GitHub commit metadata`
- `dae16ec fix: allow executable workspace tools`
- `e353364 fix: honor gitignore during Docker staging`
- `596430a fix: preserve Git executable modes`
- `6d1c787 fix: normalize partial greater-than engine ranges`
- `f821456 docs: clarify gitignore source limits`
- `d441827 docs: record field test expectations`
- `cb44146 fix: explain skipped npm install scripts`
- `8ca4fc3 fix: diagnose browser test dependencies`
- `b41002e docs: record public repository field test`
- `b84d066 docs: refresh container test evidence`
- `a8d1dc1 fix: raise GitHub repository size limit`
- `cf02646 fix: handle Git-listed symlinks`
- `22e0258 fix: copy sensitive files for fresh clones`
- `aeea9ac fix: treat skipped install scripts as informational`
- `2a35843 docs: record field-test rerun expectations`
- `bfb8cd3 docs: correct field-test report`
- `4c0900e docs: record final field-test checks`
- `a3f5031 docs: record pushed check result`
- `4daa427 fix: label Docker runtime evidence`
- `5b0de0d docs: remove machine-specific handoff path`
- `f910584 fix: clean Docker verification on signals`
- `71df55e fix: fail on verification cleanup errors`
- `bf1f8ae fix: map all report findings to coverage`
- `eb4c595 fix: supervise interrupted Docker verification`
- `b59a8d9 fix: harden build context and docs`
- `0c61257 docs: record current local baseline`
- `a762ec1 docs: update final handoff`

## OmniRush sessions for submission

- Main build session: `ses_ebf503317ffe255TeXPMMfCKMW`
- Review exploration session: `ses_ebb438187fferFPUplMV8TQS7B`
- Review scanner/report exploration session: `ses_ebb43817efferVqnNPYek8NqvZ`
- Field-test session: `ses_ebb440a63ffeifxYlQlOEyZBGL`
- Current field-test-fixes session: `ses_ebb440a63ffeifxYlQlOEyZBGL`
- Current pre-submission gap-closure session: `ses_eb723d8b8ffeSyS1IT2hp9kfEw`
- Current target-guard-fixes session: `ses_eb723d8b8ffeSyS1IT2hp9kfEw`
- Part 4 implementation session: `ses_eb6f7fc5fffeBeCHmoHZzvPT3H`
- Earlier workspace, architecture, scanner, report, Docker-review, and QA sessions remain in the prior handoff history if the dashboard requires them.

## Next user follow-up

The independent test-pass fixes are complete and green at committed baseline `1370967`; the current local baseline also includes follow-ons through `507df21`, and the worktree is clean. Commits `1fd2020`, `9aef27f`, `1370967`, `c797cbd`, `4495268`, and `507df21` are present on local `main` but are not yet pushed; local `main` is ahead of `origin/main`. Next action: review the current commit range, push `main`, and record the resulting CI receipt before completing the remaining Buildathon submission tasks.

```bash
git status --short --branch
git log --oneline --decorate -10
git show --stat --oneline HEAD
git diff --check
git show --stat --oneline 1370967
npm test
git log --oneline -10
docker build -t cloneproof .
docker run --rm --network none cloneproof npm test
docker run --rm --network none cloneproof
node src/cli.js setup
git push origin main
node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json
```

Historical CI URLs: docs-final `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39247229775`; main `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39247368837`. Current main CI URL: `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39289281815`.
