# Development decisions

## 2026-10-15 — Start with a local Node.js CLI

- **Decision:** Build CloneProof as a Node.js CLI with no runtime dependencies and Node's built-in test runner.
- **Why:** The target projects are Node.js/TypeScript repositories; built-ins keep the tool understandable and make the offline test suite small and deterministic.
- **Trade-off:** The first release will not support every language or package manager.
- **Source:** Product kickoff requirements and the official Buildathon rebuild checklist.

## 2026-10-15 — Separate static inspection from execution

- **Decision:** `check` never executes repository code. `verify` requires explicit Docker and execution flags.
- **Why:** README commands, npm scripts, lifecycle hooks, and Dockerfiles are untrusted input. A safe default is more important than automatically making a test pass.
- **Trade-off:** Some projects will be reported as blocked instead of being run automatically.

## 2026-10-15 — Use a narrow, opt-in Docker profile

- **Decision:** Support only the npm install/test workflow in a CloneProof-controlled Node 22.19.0 container. Require `--docker --execute`; require a separate `--allow-network` flag for network access.
- **Why:** Running arbitrary README commands, package-manager choices, or target Dockerfiles would turn a helpful checker into a host execution risk. A narrow profile is testable within the Buildathon deadline.
- **Trade-off:** pnpm/Yarn projects, repositories needing external services, and projects requiring custom setup are reported as unsupported or blocked.
- **Image policy:** The verifier uses `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90` with `--pull=never`. The digest was confirmed with `docker image inspect` on 2026-10-16.

## 2026-10-15 — Official Buildathon source

- **Source:** https://omnirush.ai/buildathon
- **Relevant requirements:** public GitHub repository, README, Git history, lockfile, pinned runtime, Dockerfile, offline test command, `.env.example`, no machine-specific paths, and OmniRush sessions included with the submission.
- **Current OmniRush session:** `ses_ebf503317ffe255TeXPMMfCKMW`.

## 2026-10-16 — Bound scan and staging independently

- **Decision:** Keep static scan limits and Docker staging limits as separate policies. The scanner may inspect source files in stat-only mode or skip generated assets, while Docker staging uses 25 MiB per file, 200 MiB total, 20,000 files, and depth 25.
- **Why:** A bounded static report must distinguish incomplete core metadata from safely skipped source content, and a later Docker copy must not inherit limits intended only for inspection.
- **Trade-off:** Very large repositories may produce `incomplete`, omitted-path, or blocked staging findings instead of attempting an unbounded copy.

## 2026-10-16 — Network consent is a verification prerequisite

- **Decision:** Use npm lockfile metadata to detect external packages and report `DOCKER_NETWORK_REQUIRED` before starting Docker when `--allow-network` is absent. Classify a network error during `npm ci` as `blocked` rather than as a failed test.
- **Why:** The default remains offline and deterministic; network use is a user-authorized trust decision, not an implicit dependency-install detail.
- **Trade-off:** Projects using private registries, external services, or unusual dependency resolution may be blocked even when a broader environment could run them.

## 2026-10-16 — Keep reports on the CloneProof schema

- **Decision:** Render only schema version 2 fields and render verification output as bounded, multiline text: the last 60 lines and at most 4,000 characters per stream.
- **Why:** Compatibility aliases hid schema drift and could make reports disagree with the actual scanner. Bounded lines preserve useful diagnostics without allowing terminal output to grow without limit.

## 2026-10-16 — Accept only bounded public GitHub sources

- **Decision:** Support exact public HTTPS GitHub repository URLs as a second input form. Clone shallowly with `--depth 1 --no-tags`, without a shell or credentials, enforce checkout limits, remove `.git`, and clean up the temporary root after report generation.
- **Why:** A useful repository checker needs a reproducible remote entry point, but broad URL or credential support would expand the trust boundary beyond the Buildathon scope.
- **Trade-off:** Private repositories, alternate Git hosts, subdirectories, pull requests, archives, and repositories exceeding the checkout bounds are rejected or reported as incomplete/blocked.

## 2026-10-16 — Keep HTML reports offline and self-contained

- **Decision:** Add text, JSON, and self-contained HTML report output; `--output <file>` works with every format, creates parent folders, and keeps text output color-free.
- **Why:** A downloadable report must open locally without a server, external fonts, scripts, or a network connection, and must agree with text/JSON findings.
- **Trade-off:** The first HTML surface is a static report, not an interactive dashboard.
