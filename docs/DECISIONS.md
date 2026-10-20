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

## 2026-10-16 — Review accuracy and source-boundary fixes

- **Decision:** Keep GitHub cloning isolated from host credentials/configuration, resolve Git from trusted absolute paths, preflight public visibility/size, and preserve deterministic cleanup.
- **Decision:** Treat local Gitignore rules as part of a local checkout's reproducibility evidence, while treating GitHub checkouts as fresh clones through `freshClone: true`.
- **Decision:** Finalize every Docker verification return through one summary/cleanup helper so stored counts always match findings.
- **Decision:** Pin the verifier and project base image to `node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`; no resource-limit adjustment was needed in the Jest Phase 7 run.
- **Review session references:** `ses_ebf503317ffe255TeXPMMfCKMW`, `ses_ebb438187fferFPUplMV8TQS7B`, `ses_ebb43817efferVqnNPYek8NqvZ`.

## 2026-10-17 — Correct the field-test boundary findings

- **Decision:** Raise `MAX_REPOSITORY_BYTES` to 4 GiB. The GitHub API `size` value is a whole-history sanity signal, not the size of CloneProof's latest `--depth 1` checkout; independent checkout limits remain in force.
- **Decision:** Parse Git index modes `100755` and `120000` before removing `.git`. Git-listed symlinks are skipped by static scanning and block Docker staging consistently on every OS; if mode inspection is unavailable, local `lstat` is the only fallback. Symlink recreation inside the container remains out of scope.
- **Decision:** Apply sensitive-file omission only to local folders. Fresh public GitHub clones copy committed `.env*`, npm configuration, credentials, and certificate/key fixtures because those files are already public repository content. The controlled command still forces `npm ci --ignore-scripts`, overriding any committed `.npmrc` behavior.
- **Decision:** Make `INSTALL_SCRIPTS_SKIPPED` informational/skipped rather than a warning. Keep its package evidence and explain it when a test phase fails; do not enable lifecycle scripts.
- **Field-test result:** The corrected first-run counts are 10 correct, 2 false failures, 1 false block, and 2 environment-limited failures. After the fixes, the counts are 13 correct and 2 environment-limited failures. Full run evidence and workflow references are in `docs/FIELD_TEST.md`.
- **Current OmniRush session:** `ses_ebb440a63ffeifxYlQlOEyZBGL`.

## 2026-10-17 — Add report coverage without changing schema version 2

- **Decision:** Add the additive `report.coverage` object to schema-version-2 check and verify reports. It records stable IDs for the check groups actually attempted for the target and the fixed scope entries that CloneProof does not check.
- **Why:** A passed report should explain the evidence boundary without implying that setup, services, platform behavior, credentials, or browser/native builds were proven. Centralized exported constants keep JSON, text, and HTML output aligned.
- **Trade-off:** Unsupported, unavailable, and clone-failure reports contain only the check groups that had enough target data to be attempted; they do not claim the full static inventory. Verify retains the static scan coverage while leaving browser/native-build execution in the not-checked scope.

## 2026-10-17 — Reduce environment-warning noise by source scope

- **Decision:** Exclude tooling, examples, benchmark/docs, fixture/mock, and root configuration paths from environment-documentation findings, and treat common terminal/tooling variables as conventional keys.
- **Why:** These references describe developer tooling or process context rather than values a fresh clone must configure. The files remain part of traversal and other static checks.
- **Evidence:** The eight-repository rerun improved warning precision from 2/7 (28.6%) to 4/6 (66.7%); the judgments are recorded in `docs/FIELD_TEST.md`.

## 2026-10-17 — Validate README setup forms and registry host risk

- **Decision:** Parse README setup and script aliases without executing them, report setup-manager mismatches only for explicit setup forms, and add `PRIVATE_REGISTRY` using host-only evidence from `.npmrc`, npm lockfiles, and Git dependency URLs.
- **Why:** README commands are a user-facing setup contract, while registry credentials are a real reproducibility boundary that must be surfaced without leaking secrets.
- **Trade-off:** Bare Yarn/pnpm package commands remain intentionally ambiguous, and reports never include registry values, userinfo, or tokens.

## 2026-10-17 — Prepare the pinned Docker image explicitly

- **Decision:** Add `cloneproof setup` as the only image-pull path; verification keeps `--pull=never` and blocks when the exact digest is absent.
- **Why:** Users should not have to copy a long Docker command by hand, while verification must remain reproducible and must not change the image implicitly.
- **Decision:** Accept `CLONEPROOF_GITHUB_TOKEN` or `GITHUB_TOKEN` only for the GitHub metadata preflight, record only `target.preflightAuthenticated`, and redact the token from fetch diagnostics.
- **Why:** An optional authenticated size request reduces rate-limit friction without expanding credentials into Git, Docker, reports, or target execution.

## 2026-10-17 — Add bounded build and service indicators

- **Decision:** Report `BUILD_OUTPUT_MISSING` when a declared package output is absent and a build script exists without README build documentation; report `SERVICES_LIKELY_REQUIRED` as skipped informational evidence for compose files and common service dependencies.
- **Why:** These signals identify practical fresh-clone friction while preserving the rule that CloneProof never runs target builds or starts external services.
- **Trade-off:** Build generation, service health, and service credentials remain in `coverage.notChecked`.

## 2026-10-17 — Pre-submission gap-closure session

- **Current OmniRush session:** `ses_eb723d8b8ffeSyS1IT2hp9kfEw`.
- **Branch:** `pre-submit`, created from `a3f5031`.
- **Implementation commits:** `0b99b43`, `4926d4d`, `510c407`, `28dcc0d`, `59ec879`, `9c435aa`, `9929395`, followed by the documentation commit for the final handoff.

## 2026-10-17 — Guard scan scope and bound report evidence

- **Decision:** Reject a local target before traversal when it is the injected or actual home directory, or a filesystem root. Report `WRONG_TARGET` as a skipped warning and direct the user to one project folder or a public GitHub URL.
- **Decision:** Preserve the reason for incomplete traversal with `SCAN_ENTRY_LIMIT_EXCEEDED`, process files before subdirectories in every bounded walker, and keep the entry-limit evidence relative and deterministic.
- **Decision:** Do not run Node-oriented checks for an unsupported root. Unsupported reports contain only classification, nested-package, scan-limit, and read-error findings; their coverage lists only groups actually attempted.
- **Decision:** Bound terminal/HTML evidence to ten entries, cap `ENV_CHECK_SKIPPED` JSON evidence at 50 with a total count in its message, and summarize nested packages with a count plus five paths.
- **Decision:** Publish only `src/`, `README.md`, and `LICENSE`; CI validates the packed contents and installs the generated archive globally on Ubuntu, macOS, and Windows before running `cloneproof --help`.
- **Optional:** Add `cloneproof --version` and explicit GitHub installation guidance, including the warning about the unrelated npm package named `cloneproof`.
- **Current OmniRush session:** `ses_eb723d8b8ffeSyS1IT2hp9kfEw`.

## 2026-10-17 — Precision fixes for README, package sources, and coverage

- **Decision:** Track README `cd` transitions into other projects until the next Markdown heading; ignore commands in that state and report them as `README_OTHER_PROJECT_COMMANDS`. Unknown repository `npm start` is a warning (`README_START_COMMAND_UNKNOWN`), while explicit unknown `run` scripts remain failures.
- **Decision:** Add `package-sources`, `build-output`, and `service-indicators` coverage groups and a centralized finding-to-group map. `BUILD_OUTPUT_MISSING` is skipped/info because generated library output is commonly created at publish time; `NOT_CHECKED` labels describe the narrower claims CloneProof actually does not make.
- **Decision:** Separate public Git hosts (`GIT_DEPENDENCIES`) from private registries (`PRIVATE_REGISTRY`) and exempt a gitignored personal `.npmrc` from `CORE_FILE_GITIGNORED`. Host-only evidence remains the invariant.
- **Decision:** Treat proxy variables as conventional environment keys and preserve custom environment warnings.
- **Decision:** Use one retrying cleanup policy for GitHub clones and Docker staging, with injectable removers in tests. Cleanup failures never replace a report or change its exit status; only a temporary folder basename is printed.
- **Decision:** Replace free-form GitHub preflight errors with fixed `target.preflightReason` values and remove the old redaction-marker fields. This makes rate limits, timeouts, invalid responses, and rejected tokens actionable without leaking secret material.
- **Current precision-fixes branch:** `precision-fixes`, merged with the current `main` baseline for final integration.

## 2026-10-20 — Finish the CloneProof review fixes

- **Decision:** Treat `VERIFY_NO_TESTS_RAN` as a failed verification even when the container exits `0`. Preserve the container's real exit code, leave `failedPhase` unset, record `verification.noTestsRan: true`, and include exactly one bounded matched-line evidence item.
- **Why:** A successful process that discovers no tests does not prove the repository test suite works and must not produce a CI success.

- **Decision:** Treat `GIT_METADATA_REQUIRED` as skipped/info during `check` and warning/warning during `verify`. When a zero-test result occurs with this warning, explain that missing `.git` metadata is a likely cause.
- **Why:** Static inspection can identify the risk without blocking, while Docker verification removes `.git` before running lifecycle scripts.

- **Decision:** Treat an unknown `packageManager` declaration as `PACKAGE_MANAGER_UNRECOGNIZED` warning evidence, not a package-manager lockfile mismatch failure. Treat a missing root test script in a detected workspace as `MONOREPO_ROOT_TEST_SCRIPT_MISSING` warning evidence; keep the single-package `TEST_SCRIPT_MISSING` failure unchanged.
- **Why:** These repository shapes need review but do not prove that the target is internally inconsistent or untestable.

- **Decision:** Exclude example, fixture/mock, documentation, benchmark/performance, tooling, and CI scopes at any depth from environment-documentation warnings. Exclude conventional CI/test-service variable prefixes. Treat a literal `??`/`||` fallback or destructuring default as optional, but warn when any reference to the same key lacks a default and show only those non-defaulted references.
- **Why:** Setup-required environment keys should be surfaced without turning test fixtures and process configuration into false requirements; a mixed reference remains a real documentation gap.
- **Decision:** Extend the conventional environment-prefix exclusions to common CI and test tools (`TRAVIS_`, `CIRCLE`, `GITLAB_`, `BITBUCKET_`, `BUILDKITE_`, `JENKINS_`, `TEAMCITY_`, `APPVEYOR_`, `DRONE_`, `CODEBUILD_`, `JEST_`, `VITEST_`, `PLAYWRIGHT_`, `CYPRESS_`, `PUPPETEER_`, `KARMA_`, `MOCHA_`, `AVA_`, `TAP_`, and `WEB_TEST_RUNNER_`) while retaining the existing GitHub, runner, BrowserStack, Sauce, Codecov, Netlify, and Vercel prefixes.
- **Why:** These variables are normally supplied by CI or test tooling rather than configured by a user cloning the application. Deliberately do not exclude `AZURE_`: Azure-prefixed names overlap with real application configuration and secrets, including `AZURE_STORAGE_CONNECTION_STRING`, so those references must still produce `ENV_EXAMPLE_MISSING` when undocumented.

- **Decision:** Normalize safe GitHub repository URL variants by accepting `www.`, trailing slashes, queries, and fragments; reject `/tree/` and `/blob/` links with the canonical root; keep non-existing `owner/repo` paths local while offering a bounded GitHub hint.
- **Why:** These forms are common user input variants, while subdirectory URLs cannot be represented by the supported repository-root trust boundary.

- **Decision:** If a configured GitHub token receives HTTP 401 during the metadata preflight, retry exactly once without authorization and record only the fallback boolean/diagnostic state.
- **Why:** A stale or invalid optional token must not prevent a safe public preflight, and the token must never cross into Git, Docker, reports, or logs.

- **Decision:** Run `npm run test:leaks` in an isolated temporary directory with `TEMP`, `TMP`, and `TMPDIR` redirected, wait for detached cleanup supervisors, and leave non-empty leak directories for inspection. Keep `npm test` unchanged.
- **Why:** Shared operating-system temp folders cannot distinguish CloneProof leaks from concurrent processes; an isolated guard provides reproducible offline hygiene evidence on every CI operating system.
