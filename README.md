# CloneProof

[![CI](https://github.com/psuvraneel-cyber/Clone-Proof/actions/workflows/ci.yml/badge.svg)](https://github.com/psuvraneel-cyber/Clone-Proof/actions/workflows/ci.yml)

CloneProof is an evidence-based repository setup verification tool for Node.js and TypeScript projects. It helps maintainers find the problems that would prevent another developer from getting their project running.

CloneProof does not claim to prove that code is safe or that a repository is universally reproducible. It reports what it can verify, the evidence behind each finding, and when a check is blocked or incomplete.

## Current status

The project is being built as an OmniRush Frontier Buildathon submission. The current vertical slice is a deterministic static inspector plus an explicitly enabled, bounded Docker verification profile. Docker verification depends on a Docker-capable environment and never falls back to host execution.

## Requirements

- Node.js 22.19.0 or newer (the project pins 22.19.0 in `.nvmrc`).
- npm.
- Docker is only required for the optional execution-verification workflow; the Docker end-to-end CI job runs on Linux.

## Setup

```bash
npm ci
```

No secrets are required for local inspection. `.env.example` is included as a safe template for future optional integrations.

## Usage

Inspect a repository without executing its code:

```bash
node src/cli.js check ./path/to/repository
```

The first remote-input profile accepts only a public HTTPS GitHub repository URL and performs a GitHub API size/visibility preflight before the shallow, bounded clone. If `CLONEPROOF_GITHUB_TOKEN` is present, or otherwise `GITHUB_TOKEN` is present, CloneProof sends it as a Bearer token only on that API request. The report records `target.preflightAuthenticated: true` or `false`, but never records the token. Private repositories remain blocked even when a token is supplied. Repositories over the 4 GiB sanity limit, private repositories, and missing repositories are blocked without cloning. GitHub's `size` value describes the repository's full history, not the latest shallow checkout that CloneProof downloads. If the API is unavailable or rate-limited, CloneProof records an unavailable preflight and continues with the existing clone limits. Git runs from a CloneProof-owned temporary parent with an empty Git config, an allow-listed environment, credential helpers disabled, and Git LFS smudging disabled. CloneProof resolves Git from known absolute installation paths or absolute `PATH` entries; if none is available, the report is incomplete and no clone directory is created:

```bash
node src/cli.js check https://github.com/owner/repository
```

Request JSON output:

```bash
node src/cli.js check ./path/to/repository --format json
```

Create a report in text, JSON, or self-contained HTML. `--output` works with every format and creates missing parent folders; without it, the report is written to standard output:

```bash
node src/cli.js check ./path/to/repository --format html --output report.html
```

The intended installed command is also available after `npm link`:

```bash
cloneproof check ./path/to/repository
```

Prepare the pinned Docker verifier image explicitly when Docker verification is needed. The setup command probes the Docker daemon, reuses the exact image when it is already present, and otherwise pulls and confirms the pinned digest. It emits text and exits `0` only after the image is confirmed; Docker or pull failures exit `2`:

```bash
cloneproof setup
```

The same command can be run from a checkout before `npm link`:

```bash
node src/cli.js setup
```

Verify the supported npm workflow in Docker. Both flags are required; without them CloneProof never executes repository code:

```bash
node src/cli.js verify ./path/to/repository --docker --execute
```

The default container network is disabled. If a recognized npm lockfile says that dependency installation needs external packages, CloneProof reports `DOCKER_NETWORK_REQUIRED` before starting Docker. Make the network decision explicit to proceed. This enables the network for both dependency installation and the declared test workflow, so only use it for repositories you trust:

```bash
node src/cli.js verify ./path/to/repository --docker --execute --allow-network
```

Use `--timeout-ms N` to override the bounded verification timeout when a trusted project needs more time. The default is five minutes and the value is capped internally at ten minutes.

CloneProof uses a fixed Node 22.19.0 image, refuses to pull it implicitly during verification, ignores npm lifecycle scripts during `npm ci`, runs the declared `npm test` script only after explicit authorization, and never falls back to host execution. The controlled container defaults to one CPU, 2 GiB memory/swap, 512 PIDs, a 512 MiB `/tmp`, and a 1024 MiB `/workspace`. Run `cloneproof setup` first to make the exact image available.

## Test and build

The canonical offline test command is:

```bash
npm test
```

On Linux, the Buildathon-friendly wrapper is:

```bash
make test
```

Build syntax-checks the source files:

```bash
npm run build
```

This CLI has no hosted deployment target. For submission, publish the repository publicly on the connected GitHub account; for local use, run it from the checkout or build the included Docker image.

## Docker build

On a Docker-capable machine:

```bash
docker build -t cloneproof .
docker run --rm --network none cloneproof
```

The container runs CloneProof's static inspection against the project copy. Target-repository verification is intentionally separate and uses a temporary, read-only source snapshot with bounded CPU, memory, process count, output, and wall-clock time. CloneProof does not run a target Dockerfile or accept arbitrary Docker flags.

Docker commands use the local default Docker endpoint. CloneProof creates an isolated temporary Docker CLI configuration and does not inherit the user's Docker context selection or silently honor a remote context.

## Checks

`check` and the static phase of `verify` report the following check groups. The JSON report's `coverage.checked` array records the groups actually attempted for that target; it does not claim that an unavailable or unsupported target was fully inspected.

| ID | Check group |
|---|---|
| `package-manifest` | Package manifest |
| `lockfile-presence-validity-sync` | Lockfile presence, validity, and synchronization |
| `package-manager-consistency` | Package-manager consistency |
| `test-script` | Test script |
| `readme-npm-commands` | README npm commands and setup-manager consistency |
| `env-documentation` | Environment documentation |
| `node-runtime-declarations` | Node runtime declarations |
| `gitignored-core-files` | Gitignored core files |
| `install-scripts` | Install scripts that the Docker profile intentionally skips |
| `browser-tests` | Browser tooling reachable from the test workflow |
| `nested-packages` | Nested package boundaries |
| `project-classification` | Project classification |

Additional advisory findings are `BUILD_OUTPUT_MISSING` for missing package entrypoint/build files and `SERVICES_LIKELY_REQUIRED` for compose files or common database/cache/broker dependencies. They are bounded metadata signals: CloneProof does not run builds or start services.

The fixed `coverage.notChecked` scope includes build steps and generated output, services such as databases and caches, OS-specific scripts, private registry credentials, commands in documentation other than the README, and browser/native-build tests during `verify`.

## What a result means

### `check`

| Status | Meaning |
|---|---|
| `passed` | The scan completed and found no known problem in the check groups it actually ran. It is not proof that a fresh clone works. |
| `passed_with_warnings` | The scan completed, but one or more advisory findings need review. The process exit code is still `0`. |
| `failed` | A blocking static finding, such as an invalid manifest, missing test script, or out-of-sync lockfile, was found. Exit code `1`. |
| `blocked` | CloneProof safely refused to proceed, for example for an unsupported root, private GitHub repository, invalid URL, or checkout limit. No target code was executed. Exit code `2`. |
| `incomplete` | A required root, file, clone, or bounded scan operation could not be inspected completely. Treat the evidence as incomplete and rerun after fixing access or limits. Exit code `2`. |

### `verify`

| Status | Meaning |
|---|---|
| `passed` | `npm ci --ignore-scripts` and `npm test` succeeded inside the controlled pinned container without advisory warnings. |
| `passed_with_warnings` | The controlled install/test workflow succeeded, but static warnings or intentionally omitted local files remain. |
| `failed` | The controlled Docker setup or the target's install/test workflow failed, or cleanup could not be confirmed. Review the bounded output and failed phase. |
| `blocked` | No target code was run because consent, static prerequisites, network consent, Docker, the pinned image, staging limits, or symlink policy prevented execution. |
| `incomplete` | The source could not be scanned or staged completely, so verification could not provide a complete result. |

For a passed static check, text and HTML reports say: “No known setup problems were found (N checks). This is not a guarantee that a fresh clone works; see Not checked.” For a passed verification, they say: “npm ci and npm test succeeded inside the controlled container.”

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the trust boundaries and module plan. See [docs/DECISIONS.md](docs/DECISIONS.md) for important implementation decisions and the current OmniRush session record.

## Security and limitations

- Static inspection does not execute repository-defined scripts, README commands, lifecycle hooks, Dockerfiles, or shell commands.
- Target repositories are untrusted input. Symlinks, malformed files, large files, and incomplete scans are handled explicitly.
- Docker is not a complete security boundary. Execution verification is opt-in, bounded, and a reproducibility experiment rather than a safety certification.
- Gitignore matching reads only the repository-root `.gitignore` and, for local repositories with a real `.git` directory, the root `.git/info/exclude`; nested `.gitignore` files are not read.
- Sensitive `.env` files, npm configuration files, credentials, and certificate/key files are excluded from local folders before Docker staging. For a fresh public GitHub clone, those committed files are copied because they are already public repository content; the command-line `npm ci --ignore-scripts` policy still overrides any committed `.npmrc`. The host environment and Docker socket are not mounted.
- For GitHub clones, executable file modes and Git-listed symlinks are read from the Git index before `.git` is removed. Executable modes are preserved; symlink paths are skipped during static scanning and block Docker verification consistently on every host OS. Local Windows filesystem scans cannot detect repository execute bits, and a `core.symlinks=false` checkout has no Git metadata available to recover its symlink identity.
- Scan reports use schema version 2 and record bounded-scan completeness, discovered/read file counts, skipped paths, and npm lockfile package metadata.
- Field-tested against 15 public repositories (2026-10-17). First run: 10 correct, 2 false failures, 1 false block, 2 environment-limited failures. After fixes: 13 correct, 2 environment-limited failures. See docs/FIELD_TEST.md.
- The verifier image is pinned to `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`; `cloneproof setup` prepares it and `--pull=never` refuses implicit image changes during verification.
- GitHub input is limited to public `https://github.com/OWNER/REPOSITORY` URLs. An optional `CLONEPROOF_GITHUB_TOKEN` (falling back to `GITHUB_TOKEN`) is sent only to the GitHub API preflight; it is never passed to Git or Docker and never appears in reports, errors, or logs. Clone failures and checkout-limit failures are reported as `incomplete` or `blocked`.
- `BUILD_OUTPUT_MISSING` checks package entrypoint references without running a build, and `SERVICES_LIKELY_REQUIRED` only reports compose/common-service indicators as skipped informational evidence. Neither finding starts a service or claims generated output was verified.
- The first release focuses on the root package of Node.js/TypeScript repositories. Monorepos, pnpm/Yarn execution, private repositories, and external services may be reported as unsupported or blocked.

## Evidence from the latest field work

The full commands, repository commits, and per-finding judgments are in [docs/FIELD_TEST.md](docs/FIELD_TEST.md).

| Measure | Result |
|---|---:|
| Public field test after fixes | 13 correct + 2 environment-limited failures / 15 repositories |
| Warning precision before filtering | 2 real / 7 warnings = 28.6% |
| Warning precision after filtering | 4 real / 6 warnings = 66.7% |
| Offline planted-bug suite | 13 / 13 detected; whitespace control produced no new finding |
| Real-repository planted-bug suite | 39 / 39 detected across three repositories |

## Future work

- Run a larger random-sample field test with pre-registered expectations.
- Add a size watchdog during clones rather than relying only on the current bounded checkout.
- Detect OS-specific setup and script requirements.
- Strengthen hostile-code isolation with gVisor or a dedicated VM.
- Add pnpm and Yarn verification profiles.
- Recreate safe Git symlinks inside the verification container when the policy permits it.

## Buildathon

The official requirements checklist is recorded in [docs/BUILDATHON_CHECKLIST.md](docs/BUILDATHON_CHECKLIST.md). The official source is <https://omnirush.ai/buildathon>.
