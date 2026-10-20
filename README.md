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

## Install

Install this CloneProof CLI directly from the GitHub repository archive:

```bash
npm install -g https://github.com/psuvraneel-cyber/Clone-Proof/archive/refs/heads/main.tar.gz
```

To run it once without installing:

```bash
npx github:psuvraneel-cyber/Clone-Proof check <project-folder>
```

To update an existing installation, run the same install command again:

```bash
npm install -g https://github.com/psuvraneel-cyber/Clone-Proof/archive/refs/heads/main.tar.gz
```

Do not run `npm install -g cloneproof`: that installs a different, unrelated npm package. Run `cloneproof check <project-folder>` from inside a project folder, not from your home folder or a drive root.

## Setup

```bash
npm ci
```

No secrets are required for local inspection. `.env.example` is included as a safe template for future optional integrations.

## Usage

Inspect a repository without executing its code. For a local path this static inspection needs neither Docker nor network access:

```bash
node src/cli.js check ./path/to/repository
```

CloneProof blocks home folders and filesystem roots immediately as `WRONG_TARGET`; pointing it at one project folder keeps the scan bounded and focused. A scan that reaches its directory-entry limit reports `SCAN_ENTRY_LIMIT_EXCEEDED` with the path where traversal stopped. Terminal and HTML findings show at most ten evidence items; use JSON for the complete bounded evidence list.

The first remote-input profile accepts a public HTTPS GitHub repository root and performs a GitHub API size/visibility preflight before the shallow, bounded clone. `https://github.com/OWNER/REPOSITORY`, the same URL with `www.`, a trailing `/`, a query string such as `?tab=readme`, or a fragment such as `#readme` are accepted and normalized to the canonical repository root. `/tree/<ref>` and `/blob/<path>` URLs are rejected with the canonical root in the error. A non-existing local path shaped like `owner/repo` remains a local target and receives a deterministic “Did you mean https://github.com/owner/repo?” hint. If `CLONEPROOF_GITHUB_TOKEN` is present, or otherwise `GITHUB_TOKEN` is present, CloneProof sends it as a Bearer token only on that API request. If GitHub returns `401`, CloneProof retries the preflight once without the token; the report records only the boolean fallback state and the safe notice never exposes the token. The report records `target.preflightAuthenticated: true` or `false`, but never records the token. Private repositories remain blocked even when a token is supplied. Repositories over the 4 GiB sanity limit, private repositories, and missing repositories are blocked without cloning. GitHub's `size` value describes the repository's full history, not the latest shallow checkout that CloneProof downloads. If the API is unavailable or rate-limited, CloneProof records an unavailable preflight and continues with the existing clone limits. Git runs from a CloneProof-owned temporary parent with an empty Git config, an allow-listed environment, credential helpers disabled, and Git LFS smudging disabled. CloneProof resolves Git from known absolute installation paths or absolute `PATH` entries; if none is available, the report is incomplete and no clone directory is created:

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

Text output uses ANSI color only when it is written to a terminal. Use `--color` or `--no-color` to set the terminal preference; the `NO_COLOR` environment variable always disables ANSI color. JSON, HTML, and report files are color-free.

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

The isolated temporary-folder leak guard runs the same offline test suite with `TEMP`, `TMP`, and `TMPDIR` redirected to a fresh folder, waits for detached cleanup supervisors, and fails if any entry remains:

```bash
npm run test:leaks
```

`npm test` remains the canonical test command; `test:leaks` is an additional hygiene check and is run in the Ubuntu, macOS, and Windows CI jobs.

This CLI has no hosted deployment target. For submission, publish the repository publicly on the connected GitHub account; for local use, run it from the checkout or build the included Docker image.

## Docker build

On a Docker-capable machine:

```bash
docker build -t cloneproof .
docker run --rm --network none cloneproof
```

The `.dockerignore` keeps dependency/build outputs and credential-like local files out of CloneProof's image build context, including dotenv files other than `.env.example`, npm/Yarn configuration, credential stores, and private key/certificate files. The container then runs CloneProof's static inspection against the project copy; this build smoke test does not verify a target repository's install or test workflow. Target-repository verification is intentionally separate and optional: `verify --docker --execute` uses a temporary, read-only source snapshot with bounded CPU, memory, process count, output, and wall-clock time, and `--allow-network` is a separate explicit choice for both dependency installation and tests. CloneProof does not run a target Dockerfile or accept arbitrary Docker flags.

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
| `package-sources` | Package registries and Git dependency hosts |
| `build-output` | Declared build output files |
| `service-indicators` | Compose files and service dependency indicators |

See [docs/FINDINGS.md](docs/FINDINGS.md) for the complete finding-code reference, status and severity definitions, and finding-to-check-group mappings.

Additional advisory findings are `GIT_DEPENDENCIES` for public Git hosts, `PRIVATE_REGISTRY` for non-public package/dependency hosts, `BUILD_OUTPUT_MISSING` for missing package entrypoint/build files, and `SERVICES_LIKELY_REQUIRED` for compose files or common database/cache/broker dependencies. `BUILD_OUTPUT_MISSING` and `SERVICES_LIKELY_REQUIRED` are skipped/info signals: CloneProof does not run builds or start services.

Notable finding codes are:

- `VERIFY_NO_TESTS_RAN` — verification exited `0`, but the bounded test output matched a zero-test result. This is a failed verification because no test-suite evidence was produced; the finding includes the first matched stdout/stderr line.
- `GIT_METADATA_REQUIRED` — a `pretest`, `test`, or `posttest` lifecycle path references `.git` metadata or Git metadata commands. It is skipped/info during `check` and warning/warning during `verify`, because the Docker snapshot intentionally removes `.git`.
- `PACKAGE_MANAGER_UNRECOGNIZED` — `package.json` declares a package manager outside the recognized npm, pnpm, Yarn, and Bun set. It is advisory and does not create a lockfile-mismatch failure by itself.
- `MONOREPO_ROOT_TEST_SCRIPT_MISSING` — a detected workspace root has no root `scripts.test`; nested packages may define the actual test workflows, so this is advisory rather than the single-package blocking `TEST_SCRIPT_MISSING` finding.

Environment-documentation warnings exclude example, fixture, mock, documentation, benchmark, performance, tooling, and CI scopes at any directory depth. Conventional CI and test-tool variables with the prefixes `CI_*`, `GITHUB_*`, `RUNNER_*`, `TRAVIS_*`, `CIRCLE`, `GITLAB_*`, `BITBUCKET_*`, `BUILDKITE_*`, `JENKINS_*`, `TEAMCITY_*`, `APPVEYOR_*`, `DRONE_*`, `CODEBUILD_*`, `JEST_*`, `VITEST_*`, `PLAYWRIGHT_*`, `CYPRESS_*`, `PUPPETEER_*`, `KARMA_*`, `MOCHA_*`, `AVA_*`, `TAP_*`, `WEB_TEST_RUNNER_*`, `BROWSERSTACK_*`, `SAUCE_*`, `CODECOV_*`, `NETLIFY_*`, and `VERCEL_*` are excluded as process or test-service configuration. `AZURE_*` is deliberately not excluded because names such as `AZURE_STORAGE_CONNECTION_STRING` can be real application settings that a fresh clone must document. A direct `process.env` or `import.meta.env` reference with a literal `??`/`||` fallback, or a destructured environment key with a default value, is optional; it is exempt only when every reference to that key is defaulted. A mixed defaulted/non-defaulted key still warns, with evidence for only the non-defaulted references.

The fixed `coverage.notChecked` scope is precise: running build steps (declared outputs are only checked for presence), starting or reaching services (only indicators are detected), OS-specific scripts, registry credentials and access (only hosts are detected), commands in documentation other than the README, and browser/native-build tests during `verify`.

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
| `failed` | The controlled Docker setup or the target's install/test workflow failed, no tests ran despite an exit code of `0`, or cleanup could not be confirmed. A zero-test result is reported as `VERIFY_NO_TESTS_RAN` with the headline “npm test exited 0, but no tests ran; this verification proves nothing about the test suite.” Review the bounded output and failed phase; zero-test failures intentionally leave `failedPhase` unset. |
| `blocked` | No target code was run because consent, static prerequisites, network consent, Docker, the pinned image, staging limits, or symlink policy prevented execution. |
| `incomplete` | The source could not be scanned or staged completely, so verification could not provide a complete result. |

For a passed static check, text and HTML reports say: “No known setup problems were found across N check groups (M findings). This is not a guarantee that a fresh clone works; see Not checked.” For a passed verification, they say: “npm ci and npm test succeeded inside the controlled container.”

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
- Field-tested against 15 public repositories with the final precision-fixes code. Run 3: 13 correct and 2 environment-limited failures. See docs/FIELD_TEST.md.
- The verifier image is pinned to `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`; `cloneproof setup` prepares it and `--pull=never` refuses implicit image changes during verification.
- GitHub input is limited to public `https://github.com/OWNER/REPOSITORY` URLs. An optional `CLONEPROOF_GITHUB_TOKEN` (falling back to `GITHUB_TOKEN`) is sent only to the GitHub API preflight; it is never passed to Git or Docker and never appears in reports, errors, or logs. `target.preflightReason` uses fixed values such as `checked`, `http-401`, `rate-limited`, `timeout`, and `network-error`; a rejected configured token produces a safe 401 notice without its value.
- Git dependencies on public Git hosts produce `GIT_DEPENDENCIES`; private registries and non-public dependency hosts produce `PRIVATE_REGISTRY`. Reports contain host-only evidence. A gitignored `.npmrc` is exempt from `CORE_FILE_GITIGNORED` so personal credentials are not treated as a reproducibility failure.
- `BUILD_OUTPUT_MISSING` checks package entrypoint references without running a build, and `SERVICES_LIKELY_REQUIRED` only reports compose/common-service indicators as skipped informational evidence. Neither finding starts a service or claims generated output was verified.
- The first release focuses on the root package of Node.js/TypeScript repositories. Monorepos, pnpm/Yarn execution, private repositories, and external services may be reported as unsupported or blocked.

## Evidence from the latest field work

The full commands, repository commits, and per-finding judgments are in [docs/FIELD_TEST.md](docs/FIELD_TEST.md).

| Measure | Result |
|---|---:|
| Run 3 public field test | 13 correct + 2 environment-limited failures / 15 repositories |
| Run 3 warning precision | 5 real / 6 warnings = 83.3% |
| Run 3 failed-finding precision | not applicable: 0 real / 0 failures |
| Run 3 combined warning/failure precision | 5 real / 6 findings = 83.3% |
| Offline planted-bug mutations | 13 / 13 detected; whitespace control produced no new finding (static scanner only) |
| Manual real-repository planted-bug run | 39 / 39 detected across three repositories (`scripts/planted-bugs-real.js`; network-dependent and separate from `npm test`) |
| Windows temp-folder measurement | 0 new folders across 10 exact `npm test` runs |

## Future work

- Run a larger random-sample field test with pre-registered expectations.
- Add a size watchdog during clones rather than relying only on the current bounded checkout.
- Detect OS-specific setup and script requirements.
- Strengthen hostile-code isolation with gVisor or a dedicated VM.
- Add pnpm and Yarn verification profiles.
- Recreate safe Git symlinks inside the verification container when the policy permits it.

## Buildathon

The official requirements checklist is recorded in [docs/BUILDATHON_CHECKLIST.md](docs/BUILDATHON_CHECKLIST.md). The official source is <https://omnirush.ai/buildathon>.
