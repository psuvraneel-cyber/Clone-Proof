# CloneProof security model

CloneProof receives repository files as untrusted input. It is not a malware scanner, sandbox certification, or proof that a repository is safe.

## Static mode

`cloneproof check` is the safe default. It:

- For a local path, reads files only; it starts no process and does not run Node, npm, Git, Docker, shell commands, README commands, lifecycle hooks, or Dockerfiles. For a GitHub URL, it runs one isolated `git clone` after the public size/visibility check, then performs the same read-only scan without executing repository code.
- Skips `.git`, `node_modules`, `dist`, `coverage`, and other recognized generated/cache directories.
- Does not follow symlinks.
- Enforces depth, file count, individual file size, lockfile size/entry, and total-size limits, while treating generated assets and ordinary source files as stat-only or skippable where appropriate.
- Sorts paths and findings so repeated scans are deterministic.
- Gitignore matching reads only the repository-root `.gitignore` and, for local repositories with a real `.git` directory, the root `.git/info/exclude`; nested `.gitignore` files are not read.
- Uses relative paths in reports and does not include host environment values.
- Treats standard proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` and lowercase forms) as conventional process configuration; custom environment keys remain subject to the documentation check.
- Parses README setup and script commands as data only. It tracks commands for generated/nested projects after `cd` until the next Markdown heading, reports them as `README_OTHER_PROJECT_COMMANDS`, downgrades unknown repository `npm start` to `README_START_COMMAND_UNKNOWN`, validates setup-manager mismatches, and never executes README commands.
- Treats root `.npmrc` as package-source metadata and reports non-public registry/dependency hosts as `PRIVATE_REGISTRY`, while public Git hosts produce informational/skipped `GIT_DEPENDENCIES`. It strips URL user/password components and does not report token, auth, password, username, or setting values. A gitignored `.npmrc` is exempt from the core-file reproducibility warning.
- Checks build output references with regular-file metadata only when a build script exists, and reports skipped/info `BUILD_OUTPUT_MISSING` without executing the build. It also reports `SERVICES_LIKELY_REQUIRED` as skipped informational evidence for compose files and common service dependencies; neither signal starts a service or connects to a database.

Static findings identify high-confidence setup inconsistencies. They are not a security verdict.

## GitHub source mode

When the target is a URL, CloneProof accepts a public HTTPS GitHub repository root. `www.`, a trailing slash, query strings, and fragments are normalized to the canonical root; `/tree/` and `/blob/` subdirectories are rejected with that root. Non-existing local `owner/repo` paths remain local and receive a bounded GitHub suggestion. Credentials, alternate hosts, and non-HTTPS schemes remain rejected. Before cloning, it requests only the GitHub repository metadata endpoint with a ten-second timeout, `Accept: application/vnd.github+json`, and `User-Agent: cloneproof`. If `CLONEPROOF_GITHUB_TOKEN` is present, or otherwise `GITHUB_TOKEN` is present, the request adds only `Authorization: Bearer <token>`; `target.preflightAuthenticated` records whether that happened. `target.preflightReason` records a fixed reason without free-form network text. A configured token rejected with 401 is retried exactly once without authorization; reports and stderr expose only a safe retry notice and never the token value. The token is never copied into Git or Docker environments, reports, errors, or logs. Fetch errors redact the configured token as a safety net. A checked response blocks private/missing repositories even when authenticated, and blocks repositories over the 4 GiB `MAX_REPOSITORY_BYTES` sanity limit. GitHub's `size` value, exposed as `target.repositorySizeKb`, is the repository's full-history size; it is not the size of the latest shallow checkout. A rate limit, other response, timeout, or network error records its fixed reason and continues under the existing clone limits. Reports copy only the checked repository size, preflight state/reason, and boolean authentication state from the API response. The clone uses a trusted absolute Git executable from known installation paths or absolute `PATH` entries, an argument array and `shell: false`, `--depth 1 --no-tags`, bounded output/time, independent checkout limits, and cleanup on every failure path. Cleanup retries ten times with 100 ms delays; if it still fails, reports mark cleanup failed and show only the temporary folder basename. If Git is unavailable, the report is incomplete and the temporary clone parent is never created. Git runs from a CloneProof-owned temporary parent with a fresh HOME/XDG configuration area, an empty global config, an allow-listed environment, disabled credential helpers, disabled LFS smudging, and no host Git credentials or config. Git metadata is removed before scanning.

## Docker mode

Run `cloneproof setup` before verification when the pinned image is not already available. Setup uses the trusted Docker executable resolver and an isolated temporary `DOCKER_CONFIG`, probes the daemon, checks the exact digest, pulls only when the image is absent, and confirms the image with a second `docker image inspect`. Pull output is bounded and the pull is limited to ten minutes. Setup exits `0` only after confirmation and exits `2` for a missing Docker executable, unavailable daemon, failed pull, or failed confirmation.

`cloneproof verify` requires both `--docker` and `--execute`. The Docker profile:

- Supports the root npm workflow only.
- Uses the pinned `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` image and `--pull=never`; it never builds, pulls, or runs the target repository's Dockerfile during verification. A missing image recommends `Run cloneproof setup (or docker pull <exact reference>)`.
- Stages a regular-file snapshot. Local folders omit `.env`, npm configuration, credentials, certificate/key files, and other sensitive configuration, and report `DOCKER_SENSITIVE_FILES_OMITTED`; fresh public GitHub clones copy those committed files because they are already public repository content. Command-line flags still override any committed `.npmrc`: the controlled command always runs `npm ci --ignore-scripts`.
- For GitHub sources, reads `git ls-files -s -z` before deleting `.git`, preserves mode `100755` files in the staging snapshot, and records mode `120000` paths as symlinks. If the Git mode read is unavailable (`target.executableModes = unavailable`), symlink detection falls back to `lstat` only. Local Windows paths cannot provide reliable repository execute-bit information, so CloneProof does not infer it; a local checkout made with `core.symlinks=false` cannot be recognized as symlinked without Git metadata. Symlink paths are skipped by static scanning and block Docker verification with `DOCKER_SYMLINKS_BLOCKED`; recreating symlinks inside the container is out of scope.
- Mounts the source snapshot read-only and gives the container a separate temporary workspace.
- Drops all Linux capabilities, enables `no-new-privileges`, runs as UID/GID 1000, and sets CPU, memory, PID, file-descriptor, output, and wall-clock limits.
- Uses `--network=none` unless the user explicitly adds `--allow-network`. That flag enables the network for both dependency installation and the declared test workflow; it is not a registry-only permission.
- Reports `DOCKER_NETWORK_REQUIRED` and does not start Docker when the recognized npm lockfile contains external packages and network access was not explicitly allowed. A network failure reported during `npm ci` is also classified as blocked rather than as a repository test failure.
- Runs `npm ci --ignore-scripts` before the explicitly authorized `npm test` command.
- If the test command exits `0` but bounded output matches a zero-test result, verification fails with `VERIFY_NO_TESTS_RAN`; the real container exit code is preserved and no test phase is claimed to have failed.
- Uses `--rm` and removes the host staging directory in a `finally` block. Staging is independently bounded at 25 MiB per file, 200 MiB total, 20,000 files, and depth 25.
- Defaults to a five-minute wall-clock timeout, one CPU, 2 GiB memory/swap, 512 PIDs, a 512 MiB `/tmp`, and a 1024 MiB `/workspace`.
- Uses a temporary Docker CLI configuration containing only the process path/runtime variables and `DOCKER_CONFIG`; it does not inherit a selected Docker context or silently redirect verification to a remote endpoint.

## Important limitations

Docker is not a complete security boundary. A malicious repository could still exploit a Docker or kernel vulnerability, exhaust host-level resources outside the configured limits, or abuse any explicitly allowed network access. Do not use CloneProof as a multi-tenant hostile-code service without an additional sandbox such as a dedicated VM or cloud isolation layer.

The verifier intentionally uses the local default Docker endpoint. Remote Docker contexts, arbitrary `DOCKER_HOST` values, and context configuration are outside the supported trust model for this release.

The verifier image is pinned by the recorded digest `sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` for `node:22.19.0-bookworm-slim`. The `--pull=never` policy requires that exact reference to be available locally and prevents implicit replacement.

## Report output

JSON and HTML renderers consume the versioned CloneProof report. The HTML report is self-contained with inline styles, escapes repository-controlled text, includes no external resources, bounds displayed verification output to the last 60 lines and 4,000 characters per stream, and displays at most ten evidence items per finding. Cleanup notices expose only temporary folder basenames.

## GitHub Action security model

The native GitHub Action (`action.yml` and `src/action/`) preserves CloneProof's security architecture within the GitHub Actions runner environment:

### 1. Two trust levels: `check` vs. `verify`
- **`mode: check` (Default):** Static, read-only inspection. Starts no container and runs no repository code. Safe to run on all pull requests and workflow triggers.
- **`mode: verify` (Opt-in):** Performs static check followed by controlled Docker verification inside the pinned verification container.

### 2. Runner and event boundary restrictions
- **Linux runners only:** Docker container execution is supported and verified only on Linux runners (`runs-on: ubuntu-latest`). Runner operating system validation is derived strictly from GitHub's authoritative `RUNNER_OS` in combination with `process.platform === 'linux'`. Custom environment variables (such as `CLONEPROOF_RUNNER_OS`) are never accepted as overrides. Non-Linux runners or missing runner OS metadata fail closed with `verification-status: blocked`, fall back to a safe static check, and return exit code `2` with `DOCKER_UNAVAILABLE`.
- **Restricted workflow events:** Docker verification is restricted to trusted events: `push` and `workflow_dispatch`. Event authorization is determined strictly from GitHub's authoritative `GITHUB_EVENT_NAME` environment metadata. Custom environment variables (such as `CLONEPROOF_EVENT_NAME`) are never accepted and cannot authorize verification. Missing or empty event metadata fails closed. Untrusted events (such as `pull_request`, `pull_request_target`, `workflow_run`, and `schedule`) fail closed with `verification-status: blocked`, fall back to a safe static check, and return exit code `2` with `DOCKER_EXECUTION_CONSENT_REQUIRED`. This prevents untrusted PR authors from executing code inside runner containers or abusing runner compute resources.

### 3. Container isolation & network policy
- **Non-root user:** Container runs strictly as UID/GID 1000 (`node`).
- **Read-only root filesystem:** Prevents modifications to container system binaries.
- **Capabilities dropped:** All Linux capabilities are dropped (`--cap-drop=ALL`) with `no-new-privileges`.
- **Network isolation:** Uses `--network=none` by default. Network access is opt-in (`allow-network: 'true'`) and strictly rejected when `mode` is `check`.
- **Supervised cleanup:** An independent cleanup supervisor ensures containers and staging folders are removed even during abrupt workflow cancellations or SIGINT.

### 4. Runner secret & environment isolation
- **Environment filtering:** Only a minimal allowlist of necessary operating system variables (`PATH`, `TEMP`, `SYSTEMROOT`, etc.) is passed to child processes. Runner tokens (`GITHUB_TOKEN`, `ACTIONS_RUNTIME_TOKEN`) and workflow secrets are strictly stripped.
- **Command injection defense:** Untrusted output from child processes is sanitized to prevent workflow command injection (`::`).
- **Percent-encoded annotations:** Workflow command properties and messages are strictly percent-encoded. Emitted annotations are capped at 10 errors, 10 warnings, and 10 notices per step (max 30 total).
- **Safe Job Summaries:** Untrusted finding messages, titles, codes, and paths are escaped to prevent Markdown and HTML injection. Job summaries are capped at 512 KiB UTF-8 text with multi-byte-safe truncation, and report locations are displayed as safe logical paths (`RUNNER_TEMP/cloneproof/report.json` or workspace-relative path) without exposing host filesystem paths.
