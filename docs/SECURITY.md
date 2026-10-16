# CloneProof security model

CloneProof receives repository files as untrusted input. It is not a malware scanner, sandbox certification, or proof that a repository is safe.

## Static mode

`cloneproof check` is the safe default. It:

- For a local path, reads files only; it starts no process and does not run Node, npm, Git, Docker, shell commands, README commands, lifecycle hooks, or Dockerfiles. For a GitHub URL, it runs one isolated `git clone` after the public size/visibility check, then performs the same read-only scan without executing repository code.
- Skips `.git`, `node_modules`, `dist`, `coverage`, and other recognized generated/cache directories.
- Does not follow symlinks.
- Enforces depth, file count, individual file size, lockfile size/entry, and total-size limits, while treating generated assets and ordinary source files as stat-only or skippable where appropriate.
- Sorts paths and findings so repeated scans are deterministic.
- Uses relative paths in reports and does not include host environment values.

Static findings identify high-confidence setup inconsistencies. They are not a security verdict.

## GitHub source mode

When the target is a URL, CloneProof accepts only an exact public `https://github.com/OWNER/REPOSITORY` form. It rejects credentials, query strings, fragments, subdirectories, alternate hosts, and non-HTTPS schemes. Before cloning, it requests only the public GitHub repository metadata endpoint with a ten-second timeout, `Accept: application/vnd.github+json`, and `User-Agent: cloneproof`; it sends no authentication. A checked response blocks private/missing repositories and repositories over the 1 GiB `MAX_REPOSITORY_BYTES` limit. A rate limit, other response, timeout, or network error records `target.preflight = unavailable` and continues under the existing clone limits. Reports copy only the checked repository size and preflight state from the API response. The clone uses a trusted absolute Git executable from known installation paths or absolute `PATH` entries, an argument array and `shell: false`, `--depth 1 --no-tags`, bounded output/time, independent checkout limits, and cleanup on every failure path. If Git is unavailable, the report is incomplete and the temporary clone parent is never created. Git runs from a CloneProof-owned temporary parent with a fresh HOME/XDG configuration area, an empty global config, an allow-listed environment, disabled credential helpers, disabled LFS smudging, and no host Git credentials or config. Git metadata is removed before scanning.

## Docker mode

`cloneproof verify` requires both `--docker` and `--execute`. The Docker profile:

- Supports the root npm workflow only.
- Uses the pinned `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` image and `--pull=never`; it never builds or runs the target repository's Dockerfile.
- Stages a regular-file snapshot and excludes `.env`, npm configuration, and other sensitive configuration files.
- For GitHub sources, reads `git ls-files -s` before deleting `.git` and preserves mode `100755` files in the staging snapshot. Local Windows paths cannot provide reliable repository execute-bit information, so CloneProof does not infer it for them.
- Mounts the source snapshot read-only and gives the container a separate temporary workspace.
- Drops all Linux capabilities, enables `no-new-privileges`, runs as UID/GID 1000, and sets CPU, memory, PID, file-descriptor, output, and wall-clock limits.
- Uses `--network=none` unless the user explicitly adds `--allow-network`. That flag enables the network for both dependency installation and the declared test workflow; it is not a registry-only permission.
- Reports `DOCKER_NETWORK_REQUIRED` and does not start Docker when the recognized npm lockfile contains external packages and network access was not explicitly allowed. A network failure reported during `npm ci` is also classified as blocked rather than as a repository test failure.
- Runs `npm ci --ignore-scripts` before the explicitly authorized `npm test` command.
- Uses `--rm` and removes the host staging directory in a `finally` block. Staging is independently bounded at 25 MiB per file, 200 MiB total, 20,000 files, and depth 25.
- Defaults to a five-minute wall-clock timeout, one CPU, 2 GiB memory/swap, 512 PIDs, a 512 MiB `/tmp`, and a 1 GiB `/workspace`.
- Uses a temporary Docker CLI configuration containing only the process path/runtime variables and `DOCKER_CONFIG`; it does not inherit a selected Docker context or silently redirect verification to a remote endpoint.

## Important limitations

Docker is not a complete security boundary. A malicious repository could still exploit a Docker or kernel vulnerability, exhaust host-level resources outside the configured limits, or abuse any explicitly allowed network access. Do not use CloneProof as a multi-tenant hostile-code service without an additional sandbox such as a dedicated VM or cloud isolation layer.

The verifier intentionally uses the local default Docker endpoint. Remote Docker contexts, arbitrary `DOCKER_HOST` values, and context configuration are outside the supported trust model for this release.

The verifier image is pinned by the recorded digest `sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` for `node:22.19.0-bookworm-slim`. The `--pull=never` policy requires that exact reference to be available locally and prevents implicit replacement.

## Report output

JSON and HTML renderers consume the versioned CloneProof report. The HTML report is self-contained with inline styles, escapes repository-controlled text, includes no external resources, and bounds displayed verification output to the last 60 lines and 4,000 characters per stream.
