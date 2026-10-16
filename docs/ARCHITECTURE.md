# CloneProof architecture

CloneProof is a local, command-line-first tool. It accepts local paths and a bounded public GitHub URL source. The first release separates two trust levels:

1. **Static inspection (`check`)** reads repository files and never starts a repository-defined process.
2. **Execution verification (`verify`)** is opt-in and will use a CloneProof-controlled Docker profile with explicit consent.

## First vertical slice

The first slice targets the root of a Node.js or TypeScript repository. It reads `README.md`, `package.json`, npm lockfiles, runtime declarations, test files, and environment-variable references. It emits report schema version 2 in either readable text or JSON. The scan records which files were discovered, read, skipped, or unavailable so bounded inspection is not mistaken for a complete repository proof.

## Module boundaries

```text
src/
  cli.js                 argument parsing and exit codes
  input/                 public GitHub URL validation and bounded clone staging
  scan/                  bounded filesystem scan and deterministic rules
  report/                report schema and terminal/JSON/HTML rendering
  verify/                explicit Docker execution boundary
```

The scanner returns data. Rules turn that data into evidence-backed findings. Report renderers do not perform checks. This makes the checks deterministic and keeps the execution boundary obvious.

For a GitHub URL, `input/github.js` validates the exact public HTTPS origin, runs `git clone --depth 1 --no-tags` with an argument array and no shell, bounds the temporary checkout, removes its `.git` metadata, and returns an owned cleanup handle. Clone and checkout errors become explicit `incomplete` or `blocked` reports; credentials are never requested.

## Security assumptions

- A target repository is untrusted input.
- Static mode must not invoke `node`, `npm`, a shell, Git, or Docker.
- Symlinks are reported and not followed by default.
- Scan size, depth, file count, and individual file size are bounded.
- Report paths are relative to the target root; machine-specific absolute paths are not part of canonical JSON.
- Docker verification is not a guarantee that a repository is safe. It is a bounded reproducibility experiment and will document its limitations.

## Docker verification profile

The execution mode does not trust a target Dockerfile or arbitrary Docker flags. It uses the fixed `node:22.19.0-bookworm-slim` image, requires the image to be present locally, stages regular files into a temporary snapshot, and mounts that snapshot read-only at `/source`. The container has a writable temporary workspace, no host environment or Docker socket, a non-root user, dropped capabilities, `no-new-privileges`, CPU/memory/process/file/output/time limits, and an explicit network policy. Staging has independent file, byte, count, and depth limits so scan limits cannot accidentally become Docker limits.

The supported command sequence is controlled by CloneProof:

```text
copy staged snapshot into /workspace
npm ci --ignore-scripts
npm test
```

`--execute` is the execution consent flag. Network is `none` unless `--allow-network` is also provided; that flag applies to both `npm ci` and `npm test`. When the npm lockfile reports external packages, the verifier blocks before the Docker probe unless network consent was provided. If Docker is missing, the image is missing, static prerequisites fail, staging encounters symlinks, or a limit is exceeded, CloneProof reports `blocked` and never falls back to the host. Docker commands use an isolated temporary CLI configuration and the local default endpoint rather than inheriting a user-selected Docker context.
