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

## 2026-10-15 — Official Buildathon source

- **Source:** https://omnirush.ai/buildathon
- **Relevant requirements:** public GitHub repository, README, Git history, lockfile, pinned runtime, Dockerfile, offline test command, `.env.example`, no machine-specific paths, and OmniRush sessions included with the submission.
- **Current OmniRush session:** `ses_ebf503317ffe255TeXPMMfCKMW`.
