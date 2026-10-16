# CloneProof security model

CloneProof receives repository files as untrusted input. It is not a malware scanner, sandbox certification, or proof that a repository is safe.

## Static mode

`cloneproof check` is the safe default. It:

- Reads files only; it does not run Node, npm, Git, Docker, shell commands, README commands, lifecycle hooks, or Dockerfiles.
- Skips `.git`, `node_modules`, `dist`, `coverage`, and other recognized generated/cache directories.
- Does not follow symlinks.
- Enforces depth, file count, individual file size, lockfile size/entry, and total-size limits, while treating generated assets and ordinary source files as stat-only or skippable where appropriate.
- Sorts paths and findings so repeated scans are deterministic.
- Uses relative paths in reports and does not include host environment values.

Static findings identify high-confidence setup inconsistencies. They are not a security verdict.

## GitHub source mode

When the target is a URL, CloneProof accepts only an exact public `https://github.com/OWNER/REPOSITORY` form. It rejects credentials, query strings, fragments, subdirectories, alternate hosts, and non-HTTPS schemes. The clone uses `git` with an argument array and `shell: false`, `--depth 1 --no-tags`, bounded output/time, independent checkout limits, and cleanup on every failure path. Git metadata is removed before scanning.

## Docker mode

`cloneproof verify` requires both `--docker` and `--execute`. The Docker profile:

- Supports the root npm workflow only.
- Uses a fixed Node 22.19.0 image and `--pull=never`; it never builds or runs the target repository's Dockerfile.
- Stages a regular-file snapshot and excludes `.env`, npm configuration, and other sensitive configuration files.
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

The current image is pinned by a version tag rather than a cryptographic digest. Before treating dynamic verification as a high-assurance service, record a trusted image digest and verify it before each run.

## Report output

JSON and HTML renderers consume the versioned CloneProof report. The HTML report is self-contained with inline styles, escapes repository-controlled text, includes no external resources, and bounds displayed verification output to the last 60 lines and 4,000 characters per stream.
