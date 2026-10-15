# CloneProof handoff

Updated 2026-10-16 at revision `d5b1c58` on branch `main`.

## Goal

Deliver a credible, secure-by-design CLI for Node.js/TypeScript repository setup verification. `check` must inspect a local repository without executing its code. `verify` must run only the supported npm workflow inside an explicitly authorized, bounded Docker profile and report evidence, failures, or blocked prerequisites.

## State

### Working

- `cloneproof check <path>` produces readable terminal output and stable JSON.
- Static checks cover package metadata, npm/pnpm/Yarn lockfiles, malformed npm lockfiles, npm scripts, README npm commands, environment-example coverage, runtime declarations, Dockerfile Node versions, bounded traversal, symlink non-following, and deterministic SHA-256 snapshots.
- `cloneproof verify <path> --docker --execute` requires explicit consent, defaults to `--network=none`, uses a CloneProof-controlled Node image, stages regular files, excludes sensitive configuration, applies container limits, captures bounded output, and reports blocked Docker/image/static-prerequisite states.
- Docker timeout/output-interruption cleanup is explicitly attempted with a named container. The verifier never falls back to host execution.
- Healthy and deliberately broken demo repositories are checked in under `examples/`.
- Buildathon rules, security assumptions, decisions, demo steps, and session references are documented.

### Remaining gaps

- The Docker image is pinned to `node:22.19.0-bookworm-slim` with `--pull=never`, but not yet to a recorded cryptographic digest in CloneProof's verifier policy.
- The symlink test is skipped on this Windows host because symlink creation returned `EPERM`; run the suite on Linux to exercise that branch.
- `--allow-network` enables the network for both `npm ci` and `npm test`; it is intentionally broad and should only be used for trusted repositories.
- The static report intentionally reports warnings for environment references inside the checked-in demo fixtures and verifier source; these do not block verification.
- No Buildathon dashboard submission has been made yet.

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

## Checks observed

Working directory: `C:\Users\Sauvraneel Paul\OneDrive\Desktop\Clone-Proof`

- `npm ci --offline --ignore-scripts --no-audit --no-fund` — passed.
- `npm test` — passed: 36 passed, 1 skipped; the skip is Windows `EPERM` symlink creation.
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

Before submission, optionally repeat the clean rebuild on a separate Linux host. The real Windows Docker Desktop Linux-engine validation already passed with:

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
