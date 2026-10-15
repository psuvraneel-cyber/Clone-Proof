# CloneProof security model

CloneProof receives repository files as untrusted input. It is not a malware scanner, sandbox certification, or proof that a repository is safe.

## Static mode

`cloneproof check` is the safe default. It:

- Reads files only; it does not run Node, npm, Git, Docker, shell commands, README commands, lifecycle hooks, or Dockerfiles.
- Skips `.git`, `node_modules`, `dist`, and `coverage` directories.
- Does not follow symlinks.
- Enforces depth, file count, individual file size, and total-size limits.
- Sorts paths and findings so repeated scans are deterministic.
- Uses relative paths in reports and does not include host environment values.

Static findings identify high-confidence setup inconsistencies. They are not a security verdict.

## Docker mode

`cloneproof verify` requires both `--docker` and `--execute`. The Docker profile:

- Supports the root npm workflow only.
- Uses a fixed Node 22.19.0 image and `--pull=never`; it never builds or runs the target repository's Dockerfile.
- Stages a regular-file snapshot and excludes `.env`, npm configuration, and other sensitive configuration files.
- Mounts the source snapshot read-only and gives the container a separate temporary workspace.
- Drops all Linux capabilities, enables `no-new-privileges`, runs as UID/GID 1000, and sets CPU, memory, PID, file-descriptor, output, and wall-clock limits.
- Uses `--network=none` unless the user explicitly adds `--allow-network`. That flag enables the network for both dependency installation and the declared test workflow; it is not a registry-only permission.
- Runs `npm ci --ignore-scripts` before the explicitly authorized `npm test` command.
- Uses `--rm` and removes the host staging directory in a `finally` block.

## Important limitations

Docker is not a complete security boundary. A malicious repository could still exploit a Docker or kernel vulnerability, exhaust host-level resources outside the configured limits, or abuse any explicitly allowed network access. Do not use CloneProof as a multi-tenant hostile-code service without an additional sandbox such as a dedicated VM or cloud isolation layer.

The current image is pinned by a version tag rather than a cryptographic digest. Before treating dynamic verification as a high-assurance service, record a trusted image digest and verify it before each run.
