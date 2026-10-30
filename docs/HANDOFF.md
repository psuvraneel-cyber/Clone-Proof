# CloneProof handoff

Updated 2026-10-30. `origin/main` is at `32bf359` (the PR #4 merge) and every implementation series is merged: PR #1 `review-fixes`, PR #2 `release-prep-fixes`, and PRs #3–#4 `feature/github-action`. Main CI run `41043387519` passed for `32bf359` on Ubuntu, macOS, Windows, Docker E2E, and GitHub Action E2E. Nothing is waiting to be pushed. This file records the current resumable state; receipts from earlier passes are kept under [History](#history).

## Goal

Deliver a reproducible, secure-by-design CLI for Node.js/TypeScript repository setup verification. `check` never executes repository code: local targets are read-only scans and GitHub targets use one isolated shallow clone before scanning. `verify` runs only the supported npm workflow inside an explicitly authorized, bounded Docker profile. The native GitHub Action (`action.yml`, `src/action/`) runs the same CLI in workflows: `mode: check` by default, and `mode: verify` only on Linux runners for `push` and `workflow_dispatch` events.

## Status at a glance

| Item | State |
|---|---|
| Code | `origin/main` = `32bf359`; every branch is merged into it or has patch-equivalent commits on it. The primary checkout's local `main` is still at `ec559d7`, 3 commits behind. |
| Tests | 323 tests. Windows host: 320 passed, 0 failed, 3 skipped (symlink `EPERM`). CI Ubuntu and macOS: 322 passed, 1 skipped (the Windows-only SIGINT cleanup test). CI Windows: 323 passed. |
| Leak guard | `npm run test:leaks` passed on the Windows host at `32bf359` with the same counts. |
| CI | Main run `41043387519` passed all five jobs that run on `push`; the PR-only security guard is skipped on `push` by design. |
| Finding codes | 86 codes documented in `docs/FINDINGS.md`; every one appears in `src/`. |
| Field evidence | Run 3 (`54141a5`): 15 public repositories, 13 correct and 2 environment-limited failures; warning precision 5/6 = 83.3%; planted bugs 13/13 offline and 39/39 in real repositories. Run 4 (`ef8056d`): every recheck matched its pre-recorded expectation, and JSON was byte-identical across repeated runs on 10 repositories. No field run since the release-prep or Action work. |
| Buildathon | Every official item in `docs/BUILDATHON_CHECKLIST.md` is unchecked, and its deadline (20 October 2026, 11:59 PM IST) has passed. Whether the submission happened is not recorded in the repository. |
| Release | Version `0.1.0`; no Git tags or GitHub releases. The Action docs reference `psuvraneel-cyber/Clone-Proof@main`. |

## State

### Working: CLI

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
- Schema version 2 reports include additive `coverage.checked` and `coverage.notChecked` fields, with renderer explanations for what was and was not checked. Coverage includes package sources, build output, and service indicators, with a centralized finding/group consistency map.
- Environment warnings exclude documented tooling/example/fixture/config scopes and conventional process variables, including both cases of proxy variables.
- README checks recognize npm install aliases, start/server.js behavior, package-manager setup mismatches, and script aliases without executing README commands. Commands after `cd` into another project are summarized by `README_OTHER_PROJECT_COMMANDS`; unknown repository `npm start` is `README_START_COMMAND_UNKNOWN`.
- Root `.npmrc` and dependency metadata use host-only findings: public Git hosts produce `GIT_DEPENDENCIES`, while non-public hosts produce `PRIVATE_REGISTRY`; a gitignored personal `.npmrc` is exempt from the core-file warning.
- `cloneproof setup` prepares the exact pinned verifier image through an isolated Docker client. Optional `CLONEPROOF_GITHUB_TOKEN`/`GITHUB_TOKEN` authentication is limited to the size preflight and records only `target.preflightAuthenticated`.
- Skipped/info `BUILD_OUTPUT_MISSING` and `SERVICES_LIKELY_REQUIRED` cover build-output references and common service indicators without running builds or services.
- Local `check` resolves the target before traversal and immediately blocks home folders and filesystem roots with `WRONG_TARGET`; the home value is injectable in tests and no directory walk occurs for this finding.
- Bounded scans report `SCAN_ENTRY_LIMIT_EXCEEDED` with a relative stop path and the configured limit. Every scanner, GitHub checkout inspector, and Docker staging walker processes sorted files before sorted subdirectories.
- Unsupported roots stop after classification. They emit only `UNSUPPORTED_ROOT`/`EMPTY_REPOSITORY`, nested-package, scan-limit, and read-error findings; coverage matches those attempted groups and no Node package checks run.
- Text and HTML render at most ten evidence entries per finding with a JSON pointer. `ENV_CHECK_SKIPPED` JSON evidence is capped at 50 with its total in the message, and nested-package messages show the count plus five paths.
- npm packaging whitelists `src/`, `README.md`, and `LICENSE`; CI checks `npm pack --dry-run --json` against the sorted `git ls-files src` list plus `LICENSE`, `README.md`, and `package.json`, installs the archive globally in all three matrix operating systems, and runs `cloneproof --help`. `cloneproof --version` reports package.json's version.
- CI also installs the commit-specific GitHub archive from `https://github.com/psuvraneel-cyber/Clone-Proof/archive/${{ github.sha }}.tar.gz` with `npm install --global` on Ubuntu, macOS, and Windows, then requires `cloneproof --version` to exit `0`.
- Test hygiene is covered by `npm run test:leaks`, which runs `node --test` with `TEMP`, `TMP`, and `TMPDIR` redirected to an isolated fresh folder, waits for detached cleanup supervisors, and fails while leaving any remaining entries for inspection. CI runs it after `npm test` on Ubuntu, macOS, and Windows; `npm test` itself is unchanged.
- Text reports use distinct `Finding counts:` and `Findings:` headings; HTML uses `Finding counts` for the summary and `Findings` for the list.
- Environment references with literal `??`/`||` fallbacks or destructuring defaults are optional only when every reference is defaulted. Mixed references warn with evidence for only non-defaulted lines; bounded path and CI/test-service exclusions remain deterministic.
- `VERIFY_NO_TESTS_RAN` is a failed verification even when the container exits `0`; it records `verification.noTestsRan: true`, preserves the real container exit code, leaves `failedPhase` unset, and shows one bounded matched-line evidence item. `GIT_METADATA_REQUIRED` is skipped/info in `check`, warning/warning in `verify`, and a combined zero-test message identifies missing `.git` metadata as a likely cause.
- Zero-test detection ignores `# suites 0`/`ℹ suites 0` by themselves. Positive node:test, Jest, Vitest, Mocha, AVA, and tap counts veto a zero-test result; the real `examples/healthy-node` `node --test` output is covered as a regression and produces no `VERIFY_NO_TESTS_RAN` finding.
- Verifier image inspection retries once after a failed local probe, waiting two seconds without pulling; injected tests cover transient recovery, persistent failure, and exactly two probes. The unavailable-image recommendation tells users to run `cloneproof setup` and retry while Docker Desktop wakes.
- `PACKAGE_MANAGER_UNRECOGNIZED` and `MONOREPO_ROOT_TEST_SCRIPT_MISSING` are advisory warnings; single-package missing test scripts remain blocking. Run 4 rechecks and actual measurements are recorded in `docs/FIELD_TEST.md`.
- Git clones and Docker verification run under detached cleanup supervisors (`src/util/cleanup-supervisor.js`). They read the child PID, stop the whole process tree (`taskkill /T /F` on Windows, the process group elsewhere), retry removal ten times at 100 ms, treat zombie children as stopped, and stay alive until removal finishes. `test/cleanup-lifetime.test.js` covers supervisor lifetime.
- Git and Docker error text in JSON, text, and HTML reports is redacted by `src/util/sanitize-paths.js`: the temporary checkout, the OS temporary folder, and the home folder (forward- and back-slash variants) become `<temporary-checkout>`, `<temp>`, and `~`, while URL paths are preserved.
- `src/cli.js` is tracked with mode `100755`, and CI asserts that mode before installing dependencies.
- `docs/FINDINGS.md` documents all 86 finding codes with status, severity, and check-group definitions. `test/finding-codes.test.js` fails when a literal finding code emitted from `src/` lacks a test reference or a `FINDINGS.md` entry.

### Working: GitHub Action

- `action.yml` runs `src/action/index.js` on `node24` with no runtime dependencies. Inputs: `mode` (`check` default, or `verify`), `target-path` (default `.`), `report-path` (defaults to a file under `RUNNER_TEMP`), `allow-network` (default `false`), and `timeout-ms` (default `300000`, bounded to 1,000–600,000). Outputs: `status`, `report-path`, and `verification-status` (`not_run`, `passed`, `failed`, `blocked`, or `error`).
- The Action runs the CLI through `process.execPath` with argument arrays and `shell: false`. Child processes receive only the `MINIMAL_PROCESS_ENV_KEYS` allowlist, so runner tokens and workflow secrets are not passed. `target-path` must resolve inside `GITHUB_WORKSPACE` and `report-path` inside `GITHUB_WORKSPACE` or `RUNNER_TEMP`, without symlink escapes. Child output is sanitized against workflow-command injection, and `GITHUB_OUTPUT` writes reject newlines.
- Annotations map `failed` → `error`, `warning` → `warning`, and `skipped` → `notice`; passed findings emit nothing. Ordering is deterministic, output is capped at 10 per level (30 total), paths are workspace-relative with forward slashes, and paths that escape the workspace are omitted. `src/action/workflow-commands.js` is the only formatter and percent-encodes properties and messages.
- The Job Summary escapes untrusted Markdown/HTML, stays under 512 KiB of UTF-8 with multi-byte-safe truncation, adds a Docker Verification section in `verify` mode, and shows only logical report locations (`RUNNER_TEMP/cloneproof/report.json` or a workspace-relative path). Foreign absolute paths are never resolved as relative on POSIX runners.
- `mode: verify` runs `cloneproof setup`, then one `cloneproof verify <target> --docker --execute --format json --output <report> --timeout-ms <n>` (plus `--allow-network` when requested). A failed setup falls back to a static check with `DOCKER_IMAGE_UNAVAILABLE`, `verification-status: blocked`, and exit `2`.
- Verification is authorized only when `GITHUB_EVENT_NAME` is `push` or `workflow_dispatch`, and only when `RUNNER_OS === 'Linux'` and `process.platform === 'linux'`. There are no environment-variable or input overrides (`CLONEPROOF_EVENT_NAME` and `CLONEPROOF_RUNNER_OS` were removed). Any other event, or missing metadata, falls back to a static check with `DOCKER_EXECUTION_CONSENT_REQUIRED`; any other runner falls back with `DOCKER_UNAVAILABLE`. Both report `blocked` and exit `2`.
- Annotation or summary failures are logged to `stderr` and never change report status, report schema version 2, or exit codes.

### Working: CI workflow

- `test` runs on Ubuntu, macOS, and Windows for every `push`, `pull_request`, and `workflow_dispatch`. Steps: CLI executable-mode assertion, `npm test`, `npm run test:leaks`, a repeated Windows cleanup test, the GitHub archive global install smoke, the exact `npm pack` contents check, and the packed global CLI smoke.
- `docker-e2e` runs only on `push` and `workflow_dispatch`. It runs `cloneproof setup`, then requires `examples/healthy-node` to pass and `examples/broken-node` to be blocked, both with the pinned verifier image. It does not build CloneProof's own image.
- `action-e2e` runs only on `push` and `workflow_dispatch`. It runs the Action on `examples/healthy-node` (Test A, verify), `fixtures/failing-verify` (Test B, test-phase failure with stderr), `fixtures/isolated-network` (Test C, no network inside the container), and in `check` mode (Test E), and asserts container cleanup.
- `action-e2e-pull-request` runs only on `pull_request`. It sets a spoofed `CLONEPROOF_EVENT_NAME=push` and asserts that verification is blocked, the fallback static check ran, no container started, and the exit code is `2`.

### Remaining gaps

- This Windows host skips three symlink tests because symlink creation returns `EPERM`: the scanner's `skips symlinks without following them` and the Action's two symlink-escape tests (target path and report destination). GitHub's Windows runner runs all 323 tests. Git-listed mode `120000` handling and Docker staging are covered with injected results. Local `core.symlinks=false` checkouts cannot be recognized without Git metadata, and container symlink recreation is out of scope.
- `make test` was not run because `make` is unavailable on this Windows host; `npm test` is the portable command and the Makefile remains for Linux.
- GitHub preflight authentication is optional and still subject to rate limits; the token is never passed to Git or Docker, and unavailable preflight continues with bounded clone limits.
- Docker verification remains an opt-in reproducibility experiment, not a complete hostile-code sandbox. `--allow-network` enables network for both install and test and should be used only for trusted repositories.
- Dynamic execution supports only the root npm/Node workflow. pnpm/Yarn profiles, external service health, OS-specific scripts, and custom setup remain outside the execution profile.
- Action verification runs only on Linux runners for `push` and `workflow_dispatch`; pull requests get the static check only, by design.
- CI never builds CloneProof's own Docker image. `docker build -t cloneproof .` and the in-container `npm test`/`npm run test:leaks` runs are local checks, last recorded for PR #2.
- The field evidence (Run 3 at `54141a5`, Run 4 at `ef8056d`) predates the release-prep and Action changes; no field run has been made since.
- Local Docker checks and the field procedures were not rerun for this refresh; CI Docker E2E and Action E2E passed for `32bf359`.

## Important files

- `src/cli.js` — argument parsing, GitHub/local target handling and suggestions, output files, exit codes, and source metadata.
- `src/input/github.js` — URL validation, API preflight, trusted Git clone invocation, bounded checkout inspection, and cleanup.
- `src/util/executable.js` — trusted absolute Git and Docker executable discovery.
- `src/util/cleanup-supervisor.js` — detached cleanup supervisor for temporary folders and Git/Docker child process trees.
- `src/util/sanitize-paths.js` — host path redaction for report text.
- `src/scan/repository.js` — deterministic scanner, bounded environment parser, project classification, Gitignore matcher, and findings.
- `src/report/render.js` — canonical JSON, color-safe text, escaped self-contained HTML, bounded-output indicators, and exit-code mapping.
- `src/report/coverage.js` — stable check-group IDs, labels, and not-checked scope.
- `src/verify/docker.js` — pinned Docker profile, staging, limits, cleanup, redaction, and verification summary finalization.
- `action.yml` — Action inputs, outputs, and `node24` entry point.
- `src/action/index.js` — Action input validation, path containment, environment allowlist, event/runner authorization, setup and verify orchestration, static fallback, and outputs.
- `src/action/annotations.js`, `src/action/summary.js`, `src/action/workflow-commands.js`, `src/action/paths.js` — annotations, Job Summary, the workflow-command formatter, and shared path helpers.
- `scripts/check-temp-leaks.js` — isolated temporary-folder leak guard behind `npm run test:leaks`.
- `scripts/planted-bugs-real.js` — repeatable read-only real-repository planted-bug procedure.
- `test/github.test.js` — URL, preflight, Git isolation, trusted executable, cleanup, and network-free clone tests.
- `test/scan.test.js` — scanner, environment, classification, Gitignore, runtime, bounds, and non-execution tests.
- `test/planted-bugs.test.js` — offline realistic base and 13 one-change mutations.
- `test/report.test.js` — canonical renderers, escaping, output bounds, static badges, and exit codes.
- `test/verify.test.js` — Docker arguments, injected runner, every summary path, staging, cleanup, phases, timeout behavior, and the Windows-only SIGINT cleanup test.
- `test/cli.test.js` — CLI reports, URL forms, output formats, nested output folders, and exit codes.
- `test/action.test.js`, `test/action-annotations.test.js`, `test/action-summary.test.js` — Action behavior and authorization, annotations, and Job Summary.
- `test/finding-codes.test.js` — emitted-code coverage and the `docs/FINDINGS.md` drift check.
- `test/cleanup-lifetime.test.js` — cleanup supervisor lifetime.
- `fixtures/failing-verify`, `fixtures/isolated-network` — Action E2E fixtures for a failing test phase and for container network isolation.
- `.github/workflows/ci.yml` — test matrix, Docker E2E, Action E2E, and the PR security guard.
- `Dockerfile`, `.dockerignore`, `.nvmrc`, `package-lock.json`, `Makefile`, `.env.example` — clean rebuild artifacts.
- `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, `docs/DECISIONS.md`, `docs/FIELD_TEST.md`, `docs/FINDINGS.md`, `docs/GITHUB_ACTION.md`, `docs/BUILDATHON_CHECKLIST.md` — trust boundary, usage, decisions, field evidence, finding codes, Action reference, and submission evidence.

## Decisions to preserve

- Keep static inspection separate from execution. Never run repository scripts, README commands, lifecycle hooks, or target Dockerfiles.
- For local `check`, start no process. For GitHub `check`, run only the isolated CloneProof-owned Git clone before the read-only scan.
- Keep the first dynamic profile npm-only: `npm ci --ignore-scripts`, then the declared `npm test`, inside the pinned controlled image.
- Require `--docker --execute`; keep `--network=none` unless `--allow-network` is explicitly supplied.
- Do not trust target Dockerfiles, accept arbitrary Docker flags, mount the Docker socket, pass host secrets, inherit host Git config/credentials, or silently enable network access.
- Keep report fields relative, sorted, canonical, bounded, and free of timestamps.
- Authorize Action verification only from GitHub's own `GITHUB_EVENT_NAME` (`push`, `workflow_dispatch`) and `RUNNER_OS` plus `process.platform` (Linux). Never add environment-variable or input overrides; everything else fails closed to a static check with exit `2`.
- Keep CI jobs that run Docker directly (`docker-e2e`, `action-e2e`) on the same `push`/`workflow_dispatch` condition, so pull requests never execute repository code.
- Emit workflow commands only through `src/action/workflow-commands.js`, and never let annotation or summary failures change report status or exit codes.

## Checks for this refresh (2026-10-30, `32bf359`)

- `npm test` on the Windows host (Node 24.18.0) — passed: 323 tests, 320 passed, 0 failed, 3 skipped (symlink `EPERM`).
- `npm run test:leaks` on the Windows host — exit `0`, same counts.
- Main CI `41043387519` for `32bf359` — passed. Ubuntu and macOS: 323 tests, 322 passed, 1 skipped (the Windows-only SIGINT cleanup test). Windows: 323 passed. Docker E2E and GitHub Action E2E (Linux) passed; the PR security guard was skipped on `push` by design.
- Main CI `41033028468` for `ec559d7` (the PR #3 merge) — passed.
- PR #4 CI: run `41033393689` failed on Windows in `Docker cleanup reports removal failure without stopping its supervisor` (`Unexpected end of JSON input`, a file read race). `1fb14d7` waits for a non-empty file, and PR run `41033873949` passed.
- `docs/FINDINGS.md` lists 86 codes, and a search confirmed each one appears in `src/`.
- Not rerun for this refresh: `docker build -t cloneproof .`, in-container tests, local example verification, the field test, and `scripts/planted-bugs-real.js`.

## Repository housekeeping

- The primary checkout is on `feature/github-action` (`1fb14d7`, merged through PR #4). Its local `main` is at `ec559d7`, 3 commits behind `origin/main`.
- Every remote branch (`docs-final`, `feature/github-action`, `pre-submit`, `precision-fixes`, `release-prep-fixes`, `review-fixes`, `target-guard-fixes`) and every local branch except the four `fix/field-test-*` branches is merged into `origin/main`. Those four have patch-equivalent commits on `main` (`git cherry` reports every commit as `-`), and their sibling worktrees are marked prunable because the folders no longer exist.
- Two stashes remain, both from `precision-fixes`: `wip: preserve concurrent target-guard and docs changes` and `temporary precision work`. The `temporary issue 3-6 split` stash was dropped after its changes were salvaged (SHA `2f25b5ac99bfe900af231c4698c034991298619c`); an earlier closing note here that called it retained was outdated.
- Claude Code session worktrees under `.claude/worktrees/` are local only and sit on older commits.

## Next steps

1. Confirm whether the Buildathon submission was completed (dashboard, OmniRush sessions, track, Submission ID in Unstop, optional demo video), then update `docs/BUILDATHON_CHECKLIST.md` to match.
2. Bring the primary checkout's local `main` up to `origin/main`.
3. Optional housekeeping: prune the four stale worktrees, delete merged branches, and decide whether the two `precision-fixes` stashes are still needed.
4. Optional follow-ups: tag a release so Action users can pin a version instead of `@main`, add a CI job that builds CloneProof's own image, run a fresh field test against current code, and the README roadmap items.

```bash
git status --short --branch
git log --oneline --decorate -5
npm test
npm run test:leaks
gh run list --branch main --limit 3
git stash list
git worktree prune --dry-run
```

Current main CI URL: `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/41043387519`. Earlier main CI URLs: docs-final `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39247229775`; main `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39247368837` and `https://github.com/psuvraneel-cyber/Clone-Proof/actions/runs/39289281815`.

## History

### GitHub Action series (2026-10-30, PRs #3 and #4)

- `abd5bf3 feat: implement native JavaScript GitHub Action` — `action.yml`, `src/action/index.js`, and `test/action.test.js`.
- `465e6f8 feat: add GitHub-native annotations and job summary` — `src/action/annotations.js`, `summary.js`, `paths.js`, `workflow-commands.js`, and `docs/GITHUB_ACTION.md`.
- `d187612 feat: implement opt-in Docker verification in GitHub Action` — `mode`, `allow-network`, `timeout-ms`, and `verification-status`.
- `cdbeafe test(action): add e2e workflow and harden verify fallback consistency and timeout limits` — the `action-e2e` job plus `fixtures/failing-verify` and `fixtures/isolated-network`.
- `a2f5d78 fix(action): handle cross-platform runner paths and default argument evaluation in tests`
- `e480737 fix(summary): prevent foreign absolute paths from being resolved as relative on POSIX runners`
- `c62212c fix(summary): check lexical prefix before foreign path check in formatSafeReportPath`
- `2835af0 security(action): enforce authoritative GITHUB_EVENT_NAME and RUNNER_OS for verification authorization` — removed the `CLONEPROOF_EVENT_NAME`/`CLONEPROOF_RUNNER_OS` overrides and added the `action-e2e-pull-request` guard job.
- PR #3 merged as `ec559d7`; it also brought the 2026-10-21 commits `5f5186a` and `346e511` to `main`. Main CI `41033028468` passed.
- `dd73a8a security(ci): restrict direct Docker verification jobs to trusted GitHub events`
- `1fb14d7 fix(test): wait for non-zero file size in cleanup lifetime test to prevent Windows read race`
- PR #4 merged as `32bf359`; main CI `41043387519` passed.

### Release preparation (2026-10-20 to 2026-10-21, PR #2 and follow-ons)

- `e7bc1fa fix: mark src/cli.js executable in Git`
- `16839e6 fix: clean up Git and Docker child processes`
- `19c92e6 fix: redact host paths from reports`
- `1529fc0 Update README.md` — README rewrite pushed directly to `main`; main CI `39462991375` passed.
- `21a103e test: cover emitted finding codes`
- `6f280b6 docs: document finding codes`
- `fa61d65 fix: treat zombie children as stopped`
- `e5a4465 fix: preserve URL paths during redaction`
- `161015e chore: sync release branch with main`
- PR #2 merged as `e639f77`; main CI `39471356464` passed. The PR description recorded `npm test` at 243 tests (242 passed, 1 symlink skip); passing `npm run test:leaks`, `docker build -t cloneproof .`, `docker run --rm --network none cloneproof npm test`, and `docker run --rm --network none cloneproof npm run test:leaks`; clean package/report path-leak scans; and manual kill reproductions at 1.5 s, 4 s, and 8 s that removed every temporary parent and stopped child processes.
- `5f5186a fix: keep cleanup supervisors alive during removal` (2026-10-21) — added `test/cleanup-lifetime.test.js`.
- `346e511 test: complete finding code inventory` (2026-10-21) — completed `docs/FINDINGS.md` and extended the finding-code meta-test.

### CI-fix pass (2026-10-20, PR #1)

GitHub Actions run `39434993722` failed on the prior `6f6df5d` revision because the package-content assertion was hard-coded, `node:test` output with `suites 0` was misclassified as zero tests, and the verifier image probe had no retry. The preceding pushed revision `a762ec1` had passed main CI run `39289281815`.

- `3393290 ci: derive expected npm package contents from tracked files` updates `.github/workflows/ci.yml` so the exact npm-pack comparison derives all `src/` entries from `git ls-files src`; the local comparison passed with 11 files.
- `040ff96 fix: stop treating suites 0 as a zero-test run` removes suite-count-only triggers, adds positive-count vetoes, exports `detectNoTestsRan` for direct regression coverage, and confirms real top-level `node:test` output is not a zero-test result.
- `fef9119 fix: retry the verifier image probe once` retries a failed image inspect once after two seconds without pulling and updates the unavailable-image recommendation.
- Local `npm test` at that time — passed: 232 tests, 231 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip. Focused verification tests passed: 49 tests, 49 passed, 0 failed.
- Resolved: PR #1 merged as `bdef68f`, and main CI `39446244932` passed. The next recorded Docker checks are in PR #2 above; no separate network field recheck for this pass is recorded.

### Field-test-fix changes and fields

- `src/input/github.js`: `MAX_REPOSITORY_BYTES = 4 * 1024 * 1024 * 1024`; oversized messages identify the GitHub full-history size and 4 GiB sanity bound; `parseGitFileModes` returns sorted `executablePaths` and `symlinkPaths`.
- `src/input/github.js` / `src/cli.js`: GitHub source metadata now carries `symlinkPaths` alongside `executablePaths`; `target.repositorySizeKb`, `target.commit`, and `target.executableModes` remain relative, deterministic report metadata.
- `src/scan/repository.js`: `scanRepository` accepts Git-listed symlink paths and skips them like `lstat` symlinks; `INSTALL_SCRIPTS_SKIPPED` is `skipped`/`info`.
- `src/verify/docker.js`: `stageRepository` skips Git-listed symlinks and copies sensitive files only for `freshClone: true`; `DOCKER_SYMLINKS_BLOCKED` evidence is capped at 50 with the total in its message; local sensitive omissions remain warnings.
- `src/scan/repository.js`: environment-warning path filters, README setup parsing, `PRIVATE_REGISTRY`, build-output references, and service indicators are deterministic and host-only.
- `src/verify/docker.js` / `src/cli.js`: `cloneproof setup` probes, pulls, and confirms the pinned image without changing verify's `--pull=never` policy.
- `src/input/github.js`: optional preflight-only Bearer token handling records a boolean authentication state and redacts fetch diagnostics.
- `test/planted-bugs.test.js`: offline detection is 13/13; the documented real-repository extension detected 39/39 cases, including three whitespace-only README controls.
- `docs/FIELD_TEST.md`: the pre-run expectations, original first-run columns, fixed verdicts, 16 rerun invocations, workflow evidence, counted summaries, and current limitations are recorded. React's rerun measured 7,260 checkout files and 41,784,802 checkout bytes (~39.85 MiB) against the 1,119,361 KiB full-history API value.

### Independent test-pass fixes (2026-10-20)

- `1fd2020 fix: accept safe GitHub URL variants` updates `src/input/github.js`, `src/cli.js`, `test/github.test.js`, and `test/cli.test.js`. Safe public GitHub roots are canonicalized; tree/blob links are rejected with the canonical root; missing local `owner/repo` paths remain local and receive deterministic suggestions.
- `9aef27f fix: retry GitHub preflight after token rejection` updates `src/input/github.js`, `src/cli.js`, `test/github.test.js`, and `test/cli.test.js`. A configured-token 401 gets one unauthenticated retry, checked fallback metadata reports `preflightAuthenticated: false`, and only a boolean rejection diagnostic crosses into reports.
- `1370967 fix: explain GitHub checkout limits` updates `src/input/github.js` and `test/github.test.js`. All checkout bounds identify their configured limit and reached count at the relative stop path while preserving existing limit/path metadata.
- Separate earlier follow-ons: `c797cbd fix: preserve zero-test evidence`, `4495268 fix: bound GitHub path suggestions`, and `507df21 fix: repeat Windows cleanup in CI`; these preceded the review-fix series.
- That review intentionally changed no credentials, tokens, absolute machine paths, or the protected security model. It changed the test harness, report/scanner/verification behavior, CI leak checking, and the README/decision/field-test/handoff documentation required by the review.

### Checks at the review-fix implementation baseline (`ef8056d`)

- Focused GitHub/CLI tests after issue 8 — passed: 44 tests, 44 passed, 0 failed.
- Focused GitHub/CLI tests after issue 9 — passed: 48 tests, 48 passed, 0 failed.
- Focused GitHub tests after issue 10 — passed: 33 tests, 33 passed, 0 failed.
- Final `npm test` at `1370967` — passed: build checked 8 source files; 213 tests, 212 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- `git diff --check` — passed. No Docker or CI run was needed for these offline changes; the CI receipt at that time was `39289281815` for `a762ec1`.
- Implementation `npm test` at `ef8056d` — passed: build checked 8 source files; 223 tests, 222 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- Implementation `npm run test:leaks` at `ef8056d` — passed 10 consecutive Windows runs; every run reported 223 tests, 222 passed, 0 failed, and 1 expected symlink `EPERM` skip, with no remaining isolated leak entries.
- Focused report tests — passed: 15 tests, 15 passed, including one `Findings:` and one `Finding counts:` heading in both check and verify text reports and distinct HTML summary/list headings.
- Focused scanner tests — passed: 110 tests, 109 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip; literal defaults, mixed references, non-literal controls, and destructuring defaults are covered.
- Focused verification/report tests — passed: 58 tests, 58 passed; zero-test failure, bounded stdout/stderr evidence, real exit-code preservation, and `.git` advisory behavior are covered.
- Docker checks — `docker build -t cloneproof .` passed; the default `docker run --rm --network none cloneproof` smoke run passed; `docker run --rm --network none cloneproof npm test` passed with 223 tests, 222 passed, 0 failed, and 1 skipped; `docker run --rm --network none cloneproof npm run test:leaks` passed with the same counts; `docker ps -a --filter name=cloneproof` was empty.
- Leak-guard scratch experiment — after removing the cleanup-fix `finally` block in an uncommitted scratch copy, `npm run test:leaks` exited `1` and reported the remaining `cloneproof-docker-config-*` and `cloneproof-verify-*` entries; the scratch copy and retained leak directory were then removed.

### Historical checks observed

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
- Post-push check against `main` at `4c0900e` — passed, exit `0`, target commit `4c0900eb03fcb4f38e00486b4ef276fd40d30`, preflight `checked`, repository size `150 KiB`, complete scan, status `passed`, 10 passed / 1 skipped / 0 failed; the clone was cleaned and the temp/container audit was empty.

### Final gap-closure checks

- `npm test` before the target-guard changes — passed: 165 tests, 164 passed, 1 skipped on Windows; the skip is the expected symlink `EPERM` case.
- `npm test` after the target-guard changes and optional version/install work — passed: 174 tests, 173 passed, 1 skipped on Windows; the skip is the expected symlink `EPERM` case.
- `git diff --check` — passed.
- `docker build -t cloneproof .` — passed using the pinned base image.
- `docker run --rm --network none cloneproof npm test` — passed: 165 tests, 165 passed, 0 skipped in Linux.
- `node src/cli.js setup` — passed; the exact verifier image was already present and no pull was needed.
- `node src/cli.js verify examples/healthy-node --docker --execute --format json` — passed, exit `0`, network `none`, cleanup complete.
- `node src/cli.js verify examples/broken-node --docker --execute --format json` — blocked, exit `2`, `DOCKER_PREREQUISITES_FAILED`, no target container started.
- Local verification at that time — `npm test` passed with 193 tests, 192 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip; `docker build -t cloneproof .` passed; `docker run --rm --network none cloneproof npm test` passed with 193 tests, 192 passed, 0 failed, and 1 skipped; and the default `docker run --rm --network none cloneproof` smoke run passed. A live Windows process-level SIGINT reproduction exited with `SIGINT` and left zero matching `cloneproof-verify-*` containers; the final Docker cleanup audit also returned no `cloneproof-verify-*` or `cloneproof-github-*` containers.
- From the user's home directory, `npx --yes github:psuvraneel-cyber/Clone-Proof#target-guard-fixes check .` exited `2` immediately with one `WRONG_TARGET` finding and no traversal output.
- Target branch CI run `39036000461` — passed on Ubuntu, macOS, Windows, and Docker E2E; pack-content and global packed-CLI smoke steps passed.
- `node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json` after the final implementation push — passed, exit `0`, `target.commit: 1b919eccaa43804addbc2fe47ba61e962862724a`, preflight `checked`, authenticated `false`, 10 checked groups, 10 passed / 1 skipped / 0 failed.
- The preflight-redaction regression test covers a token-bearing GitHub API error: reports and stderr contain only `[REDACTED]`.
- Pre-submit CI run `39028051301` and main CI run `39028381054` — passed for implementation revision `1b919ec`.
- Main CI run `39289281815` — passed for pushed revision `a762ec1`; Docker E2E and Ubuntu, macOS, and Windows package/archive smoke checks all passed.
- Docker/container cleanup audit after the final checks — no `cloneproof-verify` containers and no CloneProof GitHub clone directories remained.

### Historical final submission checks (`ec026ef`)

- Windows `npm test` — passed: 189 tests, 188 passed, 1 expected symlink `EPERM` skip; `git diff --check` passed.
- Ten exact Windows `npm test` repetitions — all exited `0`; `cloneproof-*` directory count was 0 before and 0 after, with 0 new directories.
- Plain Jest fixture verification — passed with explicit `--allow-network`, exit `0`, pinned image, and cleanup complete.
- Branch CI `39119108657` — passed on Ubuntu, macOS, Windows, and Docker E2E for `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`.
- Main CI `39119180819` — passed on Ubuntu, macOS, Windows, and Docker E2E for `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`.
- Final GitHub check against pushed `main` — passed, exit `0`, target commit `ec026efc186c81b89bbbdc6f24a8b1f108c2512d`, preflight `checked`, repository size `401 KiB`, complete scan, 11 passed / 1 skipped / 0 failed.
- Final cleanup audit — no `cloneproof-*` directories in the Windows temp directory and no containers matching `cloneproof-verify`.

### Previous handoff refresh

- At the start of this refresh, local `main` matched `origin/main` at `e0de5cf` and the working tree was clean.
- `npm test` — passed in this session: build checked 7 source files; 189 tests, 188 passed, 0 failed, and 1 expected Windows symlink `EPERM` skip.
- `git diff --check` — passed after this documentation-only edit; Git emitted only the normal Windows LF/CRLF normalization warning.
- No source, test, package, Docker, or workflow behavior changed in this refresh; only this handoff document was updated.

### Final documentation submission refresh

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

### Earlier commit series (review, field-test, and pre-submit passes)

- `ef8056d test: cover Git metadata verification warnings`
- `b5e521b fix: fail verification when no tests run`
- `c8f157f fix: exempt literal environment defaults`
- `a1336e4 fix: separate finding counts heading`
- `dbe8a93 fix: isolate temporary leak checks`

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

### OmniRush sessions for submission

- Main build session: `ses_ebf503317ffe255TeXPMMfCKMW`
- Review exploration session: `ses_ebb438187fferFPUplMV8TQS7B`
- Review scanner/report exploration session: `ses_ebb43817efferVqnNPYek8NqvZ`
- Field-test session: `ses_ebb440a63ffeifxYlQlOEyZBGL`
- Field-test-fixes session: `ses_ebb440a63ffeifxYlQlOEyZBGL`
- Pre-submission gap-closure session: `ses_eb723d8b8ffeSyS1IT2hp9kfEw`
- Target-guard-fixes session: `ses_eb723d8b8ffeSyS1IT2hp9kfEw`
- Part 4 implementation session: `ses_eb6f7fc5fffeBeCHmoHZzvPT3H`
- Earlier workspace, architecture, scanner, report, Docker-review, and QA sessions remain in the prior handoff history if the dashboard requires them.
- Session IDs for the 2026-10-20 to 2026-10-30 release-prep and GitHub Action work are not recorded in this file.
