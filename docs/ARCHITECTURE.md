# CloneProof architecture

CloneProof is a local, command-line-first tool. It accepts local paths and a bounded public GitHub URL source. The first release separates two trust levels:

1. **Static inspection (`check`)** never executes repository code. For a local path it starts no process; for a GitHub URL it starts exactly one isolated `git clone` before the read-only scan.
2. **Execution verification (`verify`)** is opt-in and will use a CloneProof-controlled Docker profile with explicit consent.

## First vertical slice

The first slice targets the root of a Node.js or TypeScript repository. It reads `README.md`, `package.json`, npm lockfiles, runtime declarations, test files, and environment-variable references. It emits report schema version 2 in either readable text or JSON. The scan records which files were discovered, read, skipped, or unavailable so bounded inspection is not mistaken for a complete repository proof.

## Module boundaries

```text
src/
  cli.js                 argument parsing, Docker setup, and exit codes
  input/                 public GitHub URL validation and bounded clone staging
  scan/                  bounded filesystem scan and deterministic rules
  report/                report schema and terminal/JSON/HTML rendering
  verify/                explicit Docker execution boundary
```

The scanner returns data. Rules turn that data into evidence-backed findings. Report renderers do not perform checks. This makes the checks deterministic and keeps the execution boundary obvious.

Before `scanFiles` touches a local filesystem entry, `scanRepository` resolves the target and rejects the current home directory and any filesystem root with `WRONG_TARGET`. The home value is injectable for tests, and the guard performs no filesystem traversal. A bounded traversal records `SCAN_ENTRY_LIMIT_EXCEEDED` with the relative path where it stopped. Every directory processes sorted non-directory entries before sorted subdirectories; the GitHub checkout inspector and Docker staging walker use the same order so root metadata is not starved by a large hidden subtree.

`report/coverage.js` exports the stable IDs for the twelve static check groups and the six `NOT_CHECKED` scope entries. `scan/repository.js` marks a group only when the corresponding static inspection is meaningful for the available target; missing roots and clone failures therefore use an empty checked list, while unsupported roots retain only classification and nested-package boundary checks that were attempted. Unsupported roots return after `UNSUPPORTED_ROOT`/`EMPTY_REPOSITORY`, nested-package, scan-limit, and read-error findings; they do not run Node package, README, environment, runtime, registry, build, service, or install-script checks. The scanner adds `report.coverage` without changing schema version 2. `verify/docker.js` clones that static coverage into its verification report, so Docker execution does not overwrite or inflate the static inventory. Text and HTML renderers use the same constants to show “What was checked” and “Not checked,” and successful reports include the bounded explanation for the check or controlled npm workflow.

Finding evidence is bounded at the report surfaces: text and HTML display ten entries and an omission marker, while JSON preserves the scanner's bounded data. `ENV_CHECK_SKIPPED` retains at most 50 evidence paths and includes the total count in its message; nested-package messages name only the count and first five paths.

### Environment warning scope

Environment references still contribute to source discovery, project classification, and test-file detection, but they do not produce `ENV_EXAMPLE_MISSING` or `ENV_KEY_MISSING` findings when the source path is clearly tooling or fixture material. The excluded path lists are deterministic:

- The first path segment is one of `scripts`, `script`, `tools`, `examples`, `example`, `benchmark`, `benchmarks`, `bench`, `docs`, `doc`, or `website`.
- Any path segment is named `fixtures`, `__fixtures__`, or `__mocks__`.
- A root file matches `*.config.js`, `*.config.cjs`, `*.config.mjs`, `*.config.ts`, `*.config.cts`, `*.config.mts`, `.eslintrc.*`, `gulpfile.*`, or `Gruntfile.*`.

The conventional environment-key list also suppresses platform and tooling noise for `CLICOLOR`, `CLICOLOR_FORCE`, `COLORTERM`, `TERM_PROGRAM`, `COLUMNS`, `DEBUG`, `NODE_DEBUG`, `NODE_PATH`, and `PATHEXT`, in addition to the existing path, shell, CI, npm, GitHub, and runner keys. These exclusions affect only environment-documentation findings; they do not hide the files from the bounded scan.

### README setup and registry metadata

README command parsing recognizes npm install/test/start and script aliases (`npm run-script`, `yarn run`, and `pnpm run`) without executing them. `npm start` is accepted when `scripts.start` or a root `server.js` exists. Setup-manager mismatch warnings are limited to bare setup forms with flags (`yarn`, `yarn install`, `pnpm install`, `pnpm i`, and `npm ci`), compare against the declared or lockfile-inferred manager, and are suppressed when the README also documents the correct manager. Root `.npmrc` is a core file for bounded inspection. The `PRIVATE_REGISTRY` warning retains only a sorted, capped host list from non-public registry settings, npm lockfile `resolved` URLs, and Git dependency URLs; URL credentials and setting values are never copied into evidence.

### Build and service signals

When a non-empty `scripts.build` exists, `BUILD_OUTPUT_MISSING` checks the regular-file paths referenced by `main`, `bin`, `exports`, and `types`. It is raised only when the referenced file is absent and the README does not document `npm run build`; the check reads filesystem metadata only and never runs the build. `SERVICES_LIKELY_REQUIRED` is an informational/skipped signal for a root `docker-compose.yml`/`compose.yaml` or dependencies commonly associated with PostgreSQL, MySQL, MongoDB, Redis, or AMQP. These are hints rather than execution checks, so build output generation and external services remain in the report’s `notChecked` scope.

For a GitHub URL, `input/github.js` validates the exact public HTTPS origin, checks public visibility and repository size before cloning, then runs one isolated `git clone --depth 1 --no-tags` with an argument array and no shell. An optional `CLONEPROOF_GITHUB_TOKEN`/`GITHUB_TOKEN` is used only as a Bearer header for that API preflight; `target.preflightAuthenticated` records a boolean and the token is excluded from Git/Docker environments and all report/error/log paths. Private responses remain blocked. The clone uses no host Git config or credentials, bounds the temporary checkout, removes its `.git` metadata, and returns an owned cleanup handle. Clone and checkout errors become explicit `incomplete` or `blocked` reports; the subsequent scan is read-only.

## Security assumptions

- A target repository is untrusted input.
- Local static mode must not invoke `node`, `npm`, a shell, Git, or Docker. GitHub static mode invokes only the isolated clone described above; it never executes repository code.
- Symlinks are reported and not followed by default.
- Scan size, depth, file count, and individual file size are bounded.
- Report paths are relative to the target root; machine-specific absolute paths are not part of canonical JSON.
- Docker verification is not a guarantee that a repository is safe. It is a bounded reproducibility experiment and will document its limitations.

## Docker verification profile

`cloneproof setup` is the explicit image-preparation path. It resolves Docker from the same trusted absolute candidates as verification, creates a temporary isolated `DOCKER_CONFIG` containing no user context, probes the daemon, inspects the exact pinned reference, pulls it only when absent with a ten-minute bounded runner, and inspects it again before returning success. Verification itself never pulls and uses `--pull=never`.

The execution mode does not trust a target Dockerfile or arbitrary Docker flags. It uses the pinned `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` image with `--pull=never`, requires the image to be present locally, stages regular files into a temporary snapshot, and mounts that snapshot read-only at `/source`. The container has a writable temporary workspace, no host environment or Docker socket, a non-root user, dropped capabilities, `no-new-privileges`, CPU/memory/process/file/output/time limits, and an explicit network policy. Staging has independent file, byte, count, and depth limits so scan limits cannot accidentally become Docker limits.

The supported command sequence is controlled by CloneProof:

```text
copy staged snapshot into /workspace
npm ci --ignore-scripts
npm test
```

`--execute` is the execution consent flag. Network is `none` unless `--allow-network` is also provided; that flag applies to both `npm ci` and `npm test`. When the npm lockfile reports external packages, the verifier blocks before the Docker probe unless network consent was provided. If Docker is missing, the image is missing, static prerequisites fail, staging encounters symlinks, or a limit is exceeded, CloneProof reports `blocked` and never falls back to the host. Docker commands use an isolated temporary CLI configuration and the local default endpoint rather than inheriting a user-selected Docker context.
