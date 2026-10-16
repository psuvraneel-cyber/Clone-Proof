# CloneProof handoff

Updated 2026-10-16; use the latest Git commit on `fix/accuracy-and-verification` as the authoritative revision.

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
- GitHub input performs a ten-second unauthenticated public visibility/size preflight. Repositories over `MAX_REPOSITORY_BYTES` (1 GiB), private repositories, and missing repositories are blocked before cloning; unavailable/rate-limited preflight continues with bounded clone limits and records `target.preflight: "unavailable"`.
- GitHub cloning resolves a trusted absolute Git executable, uses an allow-listed environment and empty Git config, disables credential helpers/LFS smudging, uses no shell, and cleans its parent directory on success and failure.
- Docker verification uses the pinned image `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`, `--pull=never`, a read-only source mount, non-root UID/GID 1000, dropped capabilities, no-new-privileges, no network by default, and bounded CPU/memory/PID/tmpfs/output/time policies.
- Every verification return is finalized through summary/cleanup normalization. `report.summary` matches `findings` on consent, prerequisite, network, Docker/image, symlink, staging-limit, source-change, execution, timeout, and cleanup paths.
- Text and HTML verification output explain omitted lines and character shortening; HTML badges are static and contain no `role="status"`.

### Remaining gaps

- The symlink integration test is skipped on this Windows host because symlink creation returned `EPERM`; the decision helper is unit-tested and the Docker staging path is covered with injected results.
- `make test` was not run because `make` is unavailable on this Windows host; `npm test` is the portable command and the Makefile remains for Linux.
- The API preflight is intentionally unauthenticated and may be unavailable under GitHub rate limits; bounded clone limits remain the fallback.
- Docker verification remains an opt-in reproducibility experiment, not a complete hostile-code sandbox. `--allow-network` enables network for both install and test and should be used only for trusted repositories.
- Dynamic execution supports only the root npm/Node workflow. pnpm/Yarn, private registries, external services, monorepos, and custom setup remain blocked or unsupported.
- No Buildathon dashboard submission, merge, push, or PR has been performed.

## Important files

- `src/cli.js` — argument parsing, GitHub-shaped target validation, output files, exit codes, and source metadata.
- `src/input/github.js` — URL validation, API preflight, trusted Git clone invocation, bounded checkout inspection, and cleanup.
- `src/util/executable.js` — trusted absolute Git and Docker executable discovery.
- `src/scan/repository.js` — deterministic scanner, bounded environment parser, project classification, Gitignore matcher, and findings.
- `src/report/render.js` — canonical JSON, color-safe text, escaped self-contained HTML, bounded-output indicators, and exit-code mapping.
- `src/verify/docker.js` — pinned Docker profile, staging, limits, cleanup, redaction, and verification summary finalization.
- `test/github.test.js` — URL, preflight, Git isolation, trusted executable, cleanup, and network-free clone tests.
- `test/scan.test.js` — scanner, environment, classification, Gitignore, runtime, bounds, and non-execution tests.
- `test/report.test.js` — canonical renderers, escaping, output bounds, static badges, and exit codes.
- `test/verify.test.js` — Docker arguments, injected runner, every summary path, staging, cleanup, phases, and timeout behavior.
- `test/cli.test.js` — CLI reports, URL forms, output formats, nested output folders, and exit codes.
- `Dockerfile`, `.dockerignore`, `.nvmrc`, `package-lock.json`, `Makefile`, `.env.example` — clean rebuild artifacts.
- `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, `docs/DECISIONS.md`, `docs/BUILDATHON_CHECKLIST.md` — trust boundary, usage, decisions, and submission evidence.

## Decisions to preserve

- Keep static inspection separate from execution. Never run repository scripts, README commands, lifecycle hooks, or target Dockerfiles.
- For local `check`, start no process. For GitHub `check`, run only the isolated CloneProof-owned Git clone before the read-only scan.
- Keep the first dynamic profile npm-only: `npm ci --ignore-scripts`, then the declared `npm test`, inside the pinned controlled image.
- Require `--docker --execute`; keep `--network=none` unless `--allow-network` is explicitly supplied.
- Do not trust target Dockerfiles, accept arbitrary Docker flags, mount the Docker socket, pass host secrets, inherit host Git config/credentials, or silently enable network access.
- Keep report fields relative, sorted, canonical, bounded, and free of timestamps.

## Checks observed

- `npm test` — passed: 109 tests, 108 passed, 1 skipped on the Windows host; the skip is the expected symlink `EPERM` case.
- `git diff --check` — passed.
- `node src/cli.js check examples/healthy-node` — passed, exit `0`.
- `node src/cli.js check examples/broken-node` — failed as intended, exit `1`.
- `node src/cli.js check . --format json` — passed; nested-package evidence contains only the two demo packages, not `.claude/worktrees` or `.opencode`.
- Reproduction A — fixed: `ENV_EXAMPLE_MISSING` reports `DATABASE_URL, PORT`, never `join` or `resolve`.
- Reproduction B — fixed: status `blocked`, exit `2`, `UNSUPPORTED_ROOT` identifies Python and `requirements.txt`.
- Reproduction C — fixed: no `ENGINES_NODE_UNSATISFIED` for `.nvmrc`/Docker Node `22` versus `>=22.19.0`.
- Reproduction D — fixed: `findings=11`, `summary.total=11`, `skipped findings=1`, `summary.skipped=1`.
- Reproduction E — fixed: isolated Git config listing showed only `command line:` entries for credential/filter policy; no host credential helper, LFS filter, sentinel, or askpass variable.
- Reproduction F — fixed: local scan retained `LOCKFILE_PRESENT` and added `CORE_FILE_GITIGNORED` for `package-lock.json`.
- `docker image inspect node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` — passed after confirming/pulling the recorded digest.
- `docker build -t cloneproof .` — passed.
- `docker run --rm --network none cloneproof` — passed, exit `0`.
- `docker run --rm --network none cloneproof npm test` — passed, exit `0`, 109 tests passed in the Linux container.
- `node src/cli.js verify examples/healthy-node --docker --execute` — passed, exit `0`, network `none`, cleanup confirmed.
- `node src/cli.js verify examples/broken-node --docker --execute` — blocked, exit `2`, no target container started.
- Real Express fixture with `npm install --package-lock-only --ignore-scripts` — no-network verify blocked with `DOCKER_NETWORK_REQUIRED`, exit `2`; `--allow-network` passed, exit `0`.
- Real Jest fixture using `node node_modules/jest/bin/jest.js --runInBand` — passed with `--allow-network`, exit `0`; no resource-limit adjustment was needed.
- Failing test fixture — failed with `failedPhase: test`; explicit stderr was visible as separate lines in text and HTML renderers.
- Hanging test fixture with `--timeout-ms 15000` — failed and timed out, cleanup confirmed; `docker ps -a --filter name=cloneproof-verify` showed no containers.
- `node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json` — passed, exit `0`, preflight `checked`, repository size `59 KiB`, clone cleaned.
- `node src/cli.js verify https://github.com/psuvraneel-cyber/Clone-Proof --docker --execute --format json` — passed, exit `0`, preflight `checked`, container exit `0`, cleanup confirmed.
- A random nonexistent public GitHub URL — blocked with `GITHUB_REPOSITORY_UNAVAILABLE`, exit `2`, no sign-in prompt.
- Two JSON checks of the same fixture with `--output` — byte-identical.
- Temporary-folder audit after GitHub checks — no `cloneproof-github-*` folders remained.

## Commits in this review pass

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

## OmniRush sessions for submission

- Main build session: `ses_ebf503317ffe255TeXPMMfCKMW`
- Review exploration session: `ses_ebb438187fferFPUplMV8TQS7B`
- Review scanner/report exploration session: `ses_ebb43817efferVqnNPYek8NqvZ`
- Earlier workspace, architecture, scanner, report, Docker-review, and QA sessions remain in the prior handoff history if the dashboard requires them.

## Next step

Review the final diff and checklist. Do not merge into `main`, push, open a PR, or submit until the user approves. The planned post-approval commands are:

```bash
git status
git diff --check
git log --oneline -10
git switch main
git merge --ff-only fix/accuracy-and-verification
git push origin main
node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json
```
