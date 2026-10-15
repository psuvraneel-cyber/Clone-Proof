# CloneProof handoff

Updated 2026-10-15 at revision `739e135` on branch `main`.

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

### Blocked or unproven

- Docker Desktop 4.95.0 and its 29.8.2 CLI are now installed per-user. The Docker engine is still unavailable because WSL 2 is not installed; the required elevated `wsl --install --no-distribution` action was canceled by Windows. Real Docker image build and real container verification have not been observed here.
- The symlink test is skipped on this Windows host because symlink creation returned `EPERM`; run the suite on Linux to exercise that branch.
- The verifier image is pinned to `node:22.19.0-bookworm-slim` with `--pull=never`, but not yet to a recorded cryptographic digest.
- `--allow-network` enables the network for both `npm ci` and `npm test`; it is intentionally broad and should only be used for trusted repositories.
- No public GitHub repository has been created or pushed, and no Buildathon dashboard submission has been made.

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
- `node src/cli.js verify examples/healthy-node --docker --execute --format json` — observed `blocked`, exit `2`, because Docker executable resolution failed before any host process was started.
- `docker build` and real Docker verification — not run; Docker Desktop is installed but its Linux engine is blocked by the missing WSL 2 prerequisite.
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

On a Docker-capable Linux machine, run:

```bash
npm ci --offline
npm test
docker pull node:22.19.0-bookworm-slim
docker build -t cloneproof .
docker run --rm --network none cloneproof
node src/cli.js verify examples/healthy-node --docker --execute
node src/cli.js verify examples/broken-node --docker --execute
```

On this Windows device, first run the WSL prerequisite from an elevated PowerShell and restart if Windows requests it:

```powershell
wsl --install --no-distribution
```

Then record the real Docker results, update the checklist, create a public GitHub repository on the connected account, push the committed history, submit the repository and sessions through the OmniRush dashboard, and copy the Submission ID into Unstop.
