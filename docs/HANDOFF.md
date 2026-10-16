# CloneProof handoff

Updated 2026-10-16; use the latest Git commit as the authoritative revision.

## Goal

Deliver a credible, secure-by-design CLI for Node.js/TypeScript repository setup verification. `check` must inspect a local repository without executing its code. `verify` must run only the supported npm workflow inside an explicitly authorized, bounded Docker profile and report evidence, failures, or blocked prerequisites.

## State

### Working

- `cloneproof check <path-or-public-github-url>` produces readable terminal output, stable schema-version-2 JSON, and a self-contained HTML report.
- Static checks cover package metadata, npm/pnpm/Yarn lockfiles, malformed npm lockfiles, npm scripts, README npm commands, environment-example coverage, runtime declarations, Dockerfile Node versions, bounded traversal, source/stat-only scan roles, nested-package boundaries, symlink non-following, and deterministic SHA-256 snapshots.
- `cloneproof verify <path> --docker --execute` requires explicit consent, defaults to `--network=none`, uses a CloneProof-controlled Node image, stages regular files with independent limits, excludes sensitive configuration, applies container limits, captures bounded multiline output, and reports blocked Docker/image/static-prerequisite/network-required states.
- Docker timeout/output-interruption cleanup is explicitly attempted with a named container. The verifier never falls back to host execution.
- Healthy and deliberately broken demo repositories are checked in under `examples/`.
- Public HTTPS GitHub input is validated, shallow-cloned with bounded resources, stripped of `.git` metadata, and cleaned up after the report is produced.
- `--format html --output <file>` writes an escaped, offline report with inline styles and bounded verification output.
- Buildathon rules, security assumptions, decisions, demo steps, and session references are documented.

### Remaining gaps

- The Docker image is pinned to `node:22.19.0-bookworm-slim` with `--pull=never`, but not yet to a recorded cryptographic digest in CloneProof's verifier policy.
- The symlink test is skipped on this Windows host because symlink creation returned `EPERM`; run the suite on Linux to exercise that branch.
- Docker Desktop's daemon was unavailable during the latest branch validation attempt; rerun the real Docker checks after starting the Linux engine.
- `--allow-network` enables the network for both `npm ci` and `npm test`; it is intentionally broad and should only be used for trusted repositories. Without it, known external npm packages block before Docker starts.
- The static report intentionally reports warnings for environment references inside the checked-in demo fixtures and verifier source; these do not block verification.
- No Buildathon dashboard submission has been made yet.
- Dynamic verification intentionally supports only the root npm/Node workflow. “Almost all GitHub repositories” should mean broad, safe static inspection with explicit `unsupported`/`blocked` results—not blind execution of arbitrary projects.

## Important files

- `src/cli.js` — command-line parsing, help, output, and exit codes.
- `src/scan/repository.js` — deterministic, bounded static inspection.
- `src/report/render.js` — stable JSON and terminal reports.
- `src/verify/docker.js` — opt-in Docker profile, staging, limits, cleanup, and redacted diagnostics.
- `examples/healthy-node/` and `examples/broken-node/` — repeatable demo fixtures.
- `test/` — scanner, report, CLI, and mocked Docker/security tests.
- `Dockerfile`, `.dockerignore`, `.nvmrc`, `package-lock.json`, `Makefile`, `.env.example` — Buildathon rebuild artifacts.
- `docs/BUILDATHON_CHECKLIST.md` — official rules and manual submission checklist.
- `docs/SECURITY.md` — threat model and limitations.
- `docs/DEMO.md` — demonstration script.
- `docs/DECISIONS.md` — architecture decisions and current session reference.

## Decisions to preserve

- Keep static inspection separate from execution. Never infer or run arbitrary README commands.
- The first dynamic profile is npm-only and runs `npm ci --ignore-scripts` followed by the declared `npm test` script.
- Treat empty/unsupported repositories as `blocked`, malformed or failed checks as `failed`, and incomplete bounded scans as `incomplete`.
- Do not trust a target Dockerfile, accept arbitrary Docker flags, mount the Docker socket, pass host secrets, or silently enable network access.
- Use an isolated temporary Docker CLI configuration and the local default endpoint; do not inherit a selected remote Docker context.

## Four-day delivery scope

The realistic submission target is:

1. **Static mode:** accept a local path or public GitHub URL, inspect any repository safely, and return useful `passed`, `warning`, `failed`, `blocked`, or `incomplete` findings without executing target code.
2. **Dynamic mode:** verify a clearly documented supported profile—root Node.js/TypeScript repositories using npm, a checked-in lockfile, and `scripts.test`—inside the controlled Docker runner.
3. **Reports:** emit readable terminal output, stable JSON, and a self-contained HTML report that can be opened locally without a server.

Do not promise that every arbitrary GitHub project can be installed and tested. Projects using unsupported languages, package managers, private registries, external services, monorepos, or special infrastructure should receive an explicit blocked/unsupported result with a recommendation.

## Prioritized remaining tasks

### P0 — Required before the final demo

- [x] Add safe public GitHub URL input, for example `check https://github.com/owner/repo`.
  - Validate only HTTPS GitHub repository URLs in the first version.
  - Clone into a bounded temporary directory with `--depth 1 --no-tags` or a pinned commit when supplied.
  - Never pass the URL through a shell string; use an argument array.
  - Apply clone timeout/size limits, clean up in `finally`, and report clone failures as `incomplete` or `blocked`.
  - Do not request credentials or silently access private repositories.
- [x] Add a self-contained HTML renderer and `--output <file>`.
  - Reuse the existing report schema so text, JSON, and HTML cannot disagree.
  - Include status counts, finding codes, evidence paths/lines, recommendations, verification outcome, network policy, and cleanup state.
  - Escape untrusted repository text and do not load external scripts, fonts, or styles.
- [x] Add offline injected-runner URL cloning tests; keep the canonical suite network-free.
- [ ] Re-run the real Docker build, healthy fixture verification, broken fixture block, and a fresh GitHub clone after the URL/HTML changes.
- [x] Update README usage and the demo script with the actual URL and HTML commands.

### P1 — Required for trustworthy repository coverage

- [ ] Improve static-analysis precision.
  - Ignore conventional host/process variables such as `PATH`, `ProgramFiles`, and `NODE_ENV` when they are not application configuration.
  - Avoid treating the tool's own verifier code and demo fixtures as the target application's required environment configuration, or label nested fixtures separately.
  - Add tests for dynamic `process.env[name]` access, literal access, test fixtures, docs, examples, and monorepo-like layouts.
- [ ] Add a compatibility matrix with explicit profiles for npm, pnpm, and Yarn.
  - Static detection can cover all three.
  - Dynamic execution should remain blocked until a package-manager-specific safe profile is implemented and tested; never silently fall back to host execution.
- [ ] Add representative fixtures and smoke checks for valid npm projects, missing lockfiles, malformed manifests, missing test scripts, failing tests, hanging tests, non-Node repositories, monorepos, and repositories requiring network access.
- [ ] Pin or verify the Docker verifier image by digest instead of relying only on `node:22.19.0-bookworm-slim` as a mutable tag. Record the resolved digest in the security documentation.
- [ ] Test CLI exit codes and HTML/JSON output for `passed`, `passed_with_warnings`, `failed`, `blocked`, and `incomplete` outcomes.
- [ ] Review cleanup, sensitive-file omission, output redaction, Docker executable discovery, and remote Docker-context protection after URL support is added.

### P2 — Only if the P0/P1 work is complete

- [ ] Add optional GitHub metadata such as default branch and commit SHA without requiring GitHub authentication.
- [ ] Add a build-command check as a separate opt-in profile; do not run arbitrary README commands.
- [ ] Add a compact HTML summary suitable for attaching to a GitHub issue or pull request, without implementing a hosted backend.
- [ ] Consider a small Python/Go static-only detector only if it does not destabilize the Node/npm core.

## Four-day execution plan

### Day 1 — URL and report surface

- Implement URL validation, shallow clone staging, cleanup, and clone error reporting.
- Implement the shared HTML renderer and output-file handling.
- Add offline fake-remote tests and one real public-repository smoke test.

### Day 2 — Static coverage and compatibility boundaries

- Fix environment-reference false positives and nested fixture handling.
- Add the compatibility matrix and explicit unsupported/blocked messages.
- Add failing, hanging, malformed, monorepo, pnpm/Yarn, and non-Node fixtures.

### Day 3 — Docker/security regression pass

- Pin/verify the verifier image digest.
- Test URL-to-Docker verification, network-disabled behavior, explicit network consent, timeout cleanup, sensitive-file omission, and report escaping.
- Rebuild the project image from a clean Docker cache if possible.

### Day 4 — Freeze and submit

- Freeze features and run `npm ci --offline`, `npm test`, `docker build`, container tests, URL checks, and HTML report checks.
- Review README, `docs/SECURITY.md`, `docs/BUILDATHON_CHECKLIST.md`, and `docs/DEMO.md` against actual behavior.
- Push the final public repository, record the final commit and OmniRush sessions, submit through the Buildathon dashboard, and save the Submission ID for Unstop.

## Checks observed

Working directory: `C:\Users\Sauvraneel Paul\OneDrive\Desktop\Clone-Proof`

- `npm ci --offline --ignore-scripts --no-audit --no-fund` — passed.
- `npm test` — passed: 69 passed, 1 skipped; the skip is Windows `EPERM` symlink creation.
- `npm test` after GitHub/HTML integration — passed: 80 passed, 1 skipped; the skip is Windows `EPERM` symlink creation.
- `npm_config_offline=true npm test` — passed with the same result.
- `npm run build` — passed; four source files syntax-checked.
- `git diff --check` — passed.
- `node src/cli.js check examples/healthy-node` — observed `passed`, exit `0`.
- `node src/cli.js check examples/broken-node` — observed `failed`, exit `1`.
- Missing repository path — observed `incomplete`, exit `2`.
- `docker version` — passed after enabling WSL 2: Docker Desktop Linux engine 29.8.2, Linux `x86_64`.
- `docker pull node:22.19.0-bookworm-slim` — passed; resolved digest `sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`.
- `docker build -t cloneproof .` — passed on Docker Desktop's Linux engine.
- `docker run --rm --network none cloneproof npm test` — passed: 37 passed, 0 skipped.
- `node src/cli.js verify examples/healthy-node --docker --execute --format json` — passed: status `passed`, container exit `0`, network `none`, cleanup confirmed. The first real attempt exposed and led to fixing the redundant `/bin/sh` argument in `5de4d11`; the rerun passed.
- A depth-1 clone of `https://github.com/psuvraneel-cyber/Clone-Proof` at `d5b1c58` — static check returned `passed_with_warnings`, 0 failures, 7 warnings, 39 files.
- The same GitHub clone — Docker verify returned `passed_with_warnings`, verification outcome `passed`, container exit `0`, cleanup confirmed.
- `make test` — not run; `make` is unavailable on this host.
- `node src/cli.js check examples/healthy-node --format json` — passed on the current branch; schema version 2, 10 passed findings, 0 warnings.
- `docker version` — latest branch validation attempt was blocked because the Docker Desktop Linux engine named pipe was unavailable; no real container was started by that attempt.

Latest local commits for the accuracy/verification work:

- `14eb5bb fix: harden Docker verification defaults` — lockfile package metadata, network-required blocking, failed-phase diagnostics, exit-code-137 messaging, and Docker resource defaults.
- `6103d97 fix: simplify report rendering` — schema-version-2 renderer, evidence details, and bounded multiline output.

## OmniRush sessions for submission

Use the main session in the Buildathon dashboard and confirm any associated sub-agent sessions are included:

- Main build session: `ses_ebf503317ffe255TeXPMMfCKMW`
- Workspace/rules investigation: `ses_ebf44fc9effeRrADBObLg7cB1n`
- Architecture/security planning: `ses_ebf44fc97ffercEX5LvjTf1JFV`
- Scanner implementation: `ses_ebf3734faffe3Azk3mt4WIWoms`
- Report implementation: `ses_ebf3734eeffeqd2i440yZUjS1`
- Docker security review: `ses_ebf1589b2ffegpY2dA2VfKGrJh`
- QA review: `ses_ebf1589a3ffeunT543GMOe6xH5`

## Next step

Start Docker Desktop's Linux engine and run the real validation again against the current branch. Then review the final public repository and submission checklist. The prior validation passed with:

```bash
npm ci --offline
npm test
docker pull node:22.19.0-bookworm-slim
docker build -t cloneproof .
docker run --rm --network none cloneproof
node src/cli.js verify examples/healthy-node --docker --execute
node src/cli.js verify examples/broken-node --docker --execute
```

Then submit the public GitHub repository and recorded sessions through the OmniRush dashboard, select the track, and copy the Submission ID into Unstop.
