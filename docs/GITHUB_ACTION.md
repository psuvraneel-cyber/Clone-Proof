# CloneProof GitHub Action

CloneProof provides a native JavaScript GitHub Action (`node24`) to run read-only static repository checks and controlled Docker container verifications directly within your GitHub Actions workflows without manual npm installations or custom scripts.

## Choosing a version

Reference a release, never a branch:

| Reference | When to use it |
|---|---|
| `psuvraneel-cyber/Clone-Proof@v0.1.1` | Default. Release tags are created once and never moved. |
| `psuvraneel-cyber/Clone-Proof@<commit-sha> # v0.1.1` | Supply-chain-sensitive workflows. Copy the full 40-character SHA of the release commit from the release page. |
| `psuvraneel-cyber/Clone-Proof@main` | Not recommended. It changes with every merge and can change behavior without notice. |

While CloneProof is `0.x`, there is no moving major tag such as `v0` or `v1`, because a `0.x` minor release may change behavior. Every upgrade is an explicit edit; read the [changelog](../CHANGELOG.md) first. Releases are listed at <https://github.com/psuvraneel-cyber/Clone-Proof/releases>.

## Usage

### 1. Static check workflow (Recommended for Pull Requests)

Static inspection is deterministic, read-only, and executes no repository code. It is safe for all pull requests from internal and external contributors.

```yaml
name: CloneProof Check
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Run CloneProof Static Check
        uses: psuvraneel-cyber/Clone-Proof@v0.1.1
        with:
          target-path: '.'
          mode: 'check'
```

### 2. Docker verification workflow (Trusted Branches and Dispatches)

Docker verification builds upon the static check by executing repository setup and tests inside a hardened, isolated Docker container using the pinned Node.js verification image.

> ⚠️ **Security Warning:** Docker verification executes repository code inside a container. It must **never** be enabled on untrusted triggers like `pull_request`. The Action enforces this by failing closed with `verification-status: blocked` on untrusted events.

```yaml
name: CloneProof Verification
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Run CloneProof Docker Verification
        uses: psuvraneel-cyber/Clone-Proof@v0.1.1
        with:
          target-path: '.'
          mode: 'verify'
          allow-network: 'false' # Set to 'true' only if npm ci requires external packages
          timeout-ms: '300000'   # 5-minute timeout (max 600000)
```

---

## Action Reference

### Action inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `target-path` | No | `.` | Repository directory to inspect. Must resolve inside `GITHUB_WORKSPACE`. |
| `report-path` | No | Auto-generated in `RUNNER_TEMP` | Destination for the JSON report. Must resolve inside `GITHUB_WORKSPACE` or `RUNNER_TEMP`. |
| `mode` | No | `check` | Execution mode: `check` (read-only static scan) or `verify` (static scan + controlled Docker verification). |
| `allow-network` | No | `false` | Enables network access in Docker verification for `npm ci` package downloads. Must be `false` when `mode` is `check`. |
| `require-tests` | No | `false` | Treat a repository without tests as failed instead of reporting a `NO_TESTS_FOUND` warning. Works in both modes. |
| `timeout-ms` | No | `300000` | Execution timeout in milliseconds for Docker verification (1,000 ms to 600,000 ms). |
| `receipt-path` | No | `RUNNER_TEMP/cloneproof/receipt.json` | Destination for the reproducibility receipt. Must resolve inside `GITHUB_WORKSPACE` or `RUNNER_TEMP`, must not be a directory or symbolic link, and must differ from `report-path`. An unsafe value fails the step before CloneProof runs. |

### Action outputs

| Output | Description |
|---|---|
| `status` | The final report status: `passed`, `passed_with_warnings`, `failed`, `blocked`, or `incomplete`. |
| `report-path` | The validated absolute path to the generated JSON report on the runner filesystem. |
| `verification-status` | The Docker verification outcome: `not_run` (in `check` mode), `passed`, `failed`, `blocked`, or `error`. |
| `receipt-path` | Absolute path to the reproducibility receipt when `receipt-status` is `created`; an empty string otherwise. |
| `receipt-status` | `created` (written, re-read, and verified) or `failed` (no receipt; see the step log). |

### Exit codes

The Action strictly preserves CloneProof CLI exit code semantics:
- `0`: Scan passed (and verification passed when requested in `verify` mode).
- `1`: Scan failed with actionable issues, or Docker installation/tests failed (`failed`).
- `2`: Execution was blocked or incomplete (`blocked`, `incomplete`, missing prerequisites, unsupported runner OS, or restricted event).

---

## Workflow annotations

CloneProof automatically translates findings from the scan report into native GitHub Actions workflow annotations. These appear inline in pull request file diffs and in workflow run logs.

### Status mapping

Finding statuses map to GitHub workflow annotation levels:

| Finding status | Annotation level | Workflow command | Notes |
|---|---|---|---|
| `failed` | `error` | `::error ...` | Indicates a blocking setup issue (e.g., missing test script, out-of-sync lockfile). |
| `warning` | `warning` | `::warning ...` | Indicates potential setup drift or mismatch (e.g., runtime version mismatch, undocumented env key). |
| `skipped` | `notice` | `::notice ...` | Informational diagnostics and check limitations. |
| `passed` | *(none)* | *(omitted)* | Passing checks do not produce noisy workflow annotations. |

### Path resolution for nested targets

When scanning a nested directory (e.g., `target-path: packages/backend`), file paths in annotations are automatically resolved **relative to `GITHUB_WORKSPACE`** using canonical forward slashes:
- Target: `packages/backend`
- Finding path: `src/server.js`
- Annotation file parameter: `packages/backend/src/server.js`

If a finding has no file location, a file-less annotation is emitted. If a path attempts directory traversal (`..`) or points outside the workspace boundary, the unsafe path is omitted from the annotation parameters for security.

### Annotation cap & prioritization

GitHub Actions limits workflow command annotations to avoid overwhelming the interface. CloneProof enforces strict per-type and total caps:
1. **Per-type cap:** At most **10 errors**, **10 warnings**, and **10 notices** per step (maximum **30 total**).
2. **Deterministic sorting:** Within each severity level, findings are sorted deterministically by file path, line number, column number, finding code, and message.
3. **No extra command:** Truncation is indicated in the Job Summary; no additional workflow notice command is emitted so truncation does not consume annotation quota.
4. **Complete preservation:** **All findings remain completely preserved in the JSON report and Job Summary.**

---

## GitHub Actions Job Summary

Whenever the `GITHUB_STEP_SUMMARY` environment variable is available, CloneProof appends a structured Markdown summary to the job run overview.

### Summary structure

The Job Summary contains:
1. **Header:** Scan result badge (`PASSED`, `PASSED WITH WARNINGS`, `FAILED`, `BLOCKED`, `INCOMPLETE`).
2. **Summary metrics:** Authoritative counts for total checks, passed, failed, warnings, and skipped checks.
3. **Findings table:** Breakdown of non-passed findings including status badge, finding code, sanitized message, workspace-relative location, and actionable recommendation.
4. **Docker Verification (in `verify` mode):**
   - Verification outcome badge (`PASSED`, `FAILED`, `BLOCKED`).
   - Controlled Docker image reference.
   - Network access status (`Enabled` or `Disabled`).
   - Phase outcome for dependency installation and test execution.
   - Execution timeout duration.
   - Count of omitted sensitive files and excluded gitignored paths.
   - Container and staging cleanup confirmation.
5. **Coverage & verification scope:**
   - **Checks performed:** Explicit list of static check groups evaluated during the scan.
   - **Scopes not checked:** Transparent list of checks out of static scope.
6. **Annotation truncation notice:** Rendered whenever annotations were capped, reporting the number of omitted workflow annotations.
7. **Report location:** The safe logical path where the JSON report was written (e.g., `RUNNER_TEMP/cloneproof/report.json` or workspace-relative path), accompanied by a note explaining that runner temporary files are local to the runner.
8. **Reproducibility Receipt:** `CREATED` with the schema version, integrity algorithm and digest, source revision (or `Unavailable`), execution mode, verification outcome, and safe logical receipt location — shown only after the receipt was written and re-verified. Otherwise `FAILED` with no digest. Byte budget is reserved for this section, so summary truncation never removes it.

### Size limit & multi-byte safety

GitHub limits step summary files to 1 MiB. CloneProof enforces a conservative **512 KiB UTF-8 byte limit**:
- Measurement is based on raw UTF-8 byte length, not JavaScript string length.
- If content exceeds 512 KiB, output is safely truncated without splitting multi-byte Unicode sequences.
- Truncation snaps backwards to the nearest newline boundary and appends a visible truncation disclaimer.

### Presentation error isolation

Failures in the presentation layer (e.g., summary filesystem write errors) are caught safely and logged to `stderr`. They **never** crash the Action, alter the scan status, or change the CLI exit code.

---

## Docker Verification Details

When `mode: verify` is requested:

### 1. Pinned image & setup
CloneProof reuses its pinned verification base image:
`node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90`
The Action automatically executes `cloneproof setup` to inspect or pull the image before verification begins.

### 2. Runtime restrictions & fail-closed guards
To protect GitHub Actions runners and infrastructure:
- **Authoritative runner OS validation:** Docker verification is currently supported only on Linux runners (`runs-on: ubuntu-latest`). Runner operating system validation is determined strictly from GitHub's `RUNNER_OS` in combination with `process.platform === 'linux'`. Custom environment variables cannot override the runner operating system. Non-Linux runners or missing runner OS values fail closed with `verification-status: blocked`, fall back to a safe static check, and return exit code `2` with `DOCKER_UNAVAILABLE`.
- **Authoritative event authorization:** Only `push` and `workflow_dispatch` events are permitted to execute verification containers. The Action determines event authorization strictly from GitHub's authoritative `GITHUB_EVENT_NAME` metadata. Custom environment variables (such as `CLONEPROOF_EVENT_NAME`) are never consulted and cannot authorize verification. Missing or empty event metadata fails closed. Untrusted events (such as `pull_request`, `pull_request_target`, `workflow_run`, and `schedule`) fail closed with `verification-status: blocked`, fall back to a safe static check, and return exit code `2` with `DOCKER_EXECUTION_CONSENT_REQUIRED`. Neither `event-name` nor `runner-os` is accepted as an Action input.

### 3. Container security hardening
The container executes under a controlled, hardened profile:
- **Non-root execution:** Runs as user `node` (UID/GID 1000).
- **Read-only root filesystem:** Protects container OS files.
- **Capabilities dropped:** All Linux capabilities dropped (`--cap-drop=ALL`).
- **Network isolation:** Network disabled (`--network=none`) by default.
- **Staging security:** Local staging omits `.env`, credentials, private keys, and gitignored files.
- **Cleanup supervisor:** An independent supervisor process guarantees removal of temporary staging directories and containers even if the runner aborts or receives SIGINT.

---

## Reproducibility receipt

Every Action run attempts a reproducibility receipt after the final report has been read and validated, and before outputs, annotations, and the Job Summary are produced. The receipt is built from that report and safe workflow metadata; the CLI is not run again and Docker verification is not repeated. The flow is: validate inputs → run the CLI once → read and validate the report → create the receipt → write it atomically → re-read and verify it → export outputs → annotations and Job Summary.

- **Default location:** `RUNNER_TEMP/cloneproof/receipt.json`, separate from the report. Override it with `receipt-path`.
- **Source identity:** the commit is read from the target's own Git checkout (`actions/checkout` keeps `.git`), searching no higher than `GITHUB_WORKSPACE` and without running Git. `source.repository` is set to `GITHUB_REPOSITORY` only when that checkout is the workspace root on `github.com`. `GITHUB_SHA` is recorded separately as `environment.github.workflowCommit`.
- **Run metadata:** `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_EVENT_NAME`, `GITHUB_REF`, `GITHUB_SHA`, `RUNNER_OS`, `RUNNER_ENVIRONMENT`, `GITHUB_ACTION_REPOSITORY`, and `GITHUB_ACTION_REF`, each validated against a strict pattern (null when malformed). No other environment variable is read.
- **Error semantics:** a receipt failure emits `CloneProof Action: reproducibility receipt was not created: …`, sets `receipt-status=failed` and an empty `receipt-path`, and leaves the report, the other outputs, annotations, and the exit code unchanged. A receipt never turns a failed scan into success or a passed scan into failure.

Verify it later with `cloneproof receipt verify <file>`. To keep it, upload it alongside the report:

```yaml
      - name: Upload CloneProof receipt
        if: always() && steps.cloneproof.outputs.receipt-status == 'created'
        uses: actions/upload-artifact@v4
        with:
          name: cloneproof-receipt
          path: ${{ steps.cloneproof.outputs.receipt-path }}
```

The receipt's SHA-256 digest detects changes only when the expected digest is trusted independently; it is not a signature or an attestation. See [RECEIPTS.md](RECEIPTS.md) for the schema and limitations.

---

## Retaining the JSON Report

To save the complete JSON report as a downloadable workflow artifact, add the official `actions/upload-artifact` step:

```yaml
      - name: Run CloneProof
        id: cloneproof
        uses: psuvraneel-cyber/Clone-Proof@v0.1.1
        with:
          target-path: '.'

      - name: Upload CloneProof Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cloneproof-report
          path: ${{ steps.cloneproof.outputs.report-path }}
```
