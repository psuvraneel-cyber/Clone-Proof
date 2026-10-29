# CloneProof GitHub Action

CloneProof provides a native JavaScript GitHub Action (`node24`) to run read-only static repository checks directly within your GitHub Actions workflows without manual npm installations or custom scripts.

## Usage

Add CloneProof to any workflow job:

```yaml
name: Setup Check
on: [push, pull_request]

jobs:
  cloneproof:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Run CloneProof
        uses: psuvraneel-cyber/Clone-Proof@main
        with:
          target-path: '.'
```

### Action inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `target-path` | No | `.` | Repository directory to inspect. Must resolve inside `GITHUB_WORKSPACE`. |
| `report-path` | No | Auto-generated in `RUNNER_TEMP` | Destination for the JSON report. Must resolve inside `GITHUB_WORKSPACE` or `RUNNER_TEMP`. |

### Action outputs

| Output | Description |
|---|---|
| `status` | The final scan result: `passed`, `passed_with_warnings`, `failed`, `blocked`, or `incomplete`. |
| `report-path` | The validated absolute path to the generated JSON report on the runner filesystem. |

### Exit codes

The Action preserves the CLI exit code semantics:
- `0`: Scan passed (`passed` or `passed_with_warnings`).
- `1`: Scan failed with actionable setup problems (`failed`).
- `2`: Scan was blocked or incomplete (`blocked`, `incomplete`, or runner environment error).

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

GitHub Actions limits workflow command annotations. CloneProof enforces a strict cap of **50 annotations** per run:
1. Findings are sorted by priority: `failed` (errors) > `warning` (warnings) > `skipped` (notices).
2. Ties are broken deterministically by file path, line number, column number, finding code, and message.
3. If more than 50 findings exist, only the top 50 are emitted, and a notice is emitted indicating how many findings were omitted.
4. **All findings remain completely preserved in the JSON report and Job Summary.**

---

## GitHub Actions Job Summary

Whenever the `GITHUB_STEP_SUMMARY` environment variable is available, CloneProof appends a structured Markdown summary to the job run overview.

### Summary structure

The Job Summary contains:
1. **Header:** Scan result badge (`PASSED`, `PASSED WITH WARNINGS`, `FAILED`, `BLOCKED`, `INCOMPLETE`).
2. **Summary metrics:** Authoritative counts for total checks, passed, failed, warnings, and skipped checks.
3. **Findings table:** Breakdown of non-passed findings including status badge, finding code, sanitized message, workspace-relative location, and actionable recommendation. (Displays a clean notice if no issues are detected).
4. **Coverage & verification scope:**
   - **Checks performed:** Explicit list of static check groups evaluated during the scan.
   - **Scopes not checked:** Transparent list of checks out of static scope (e.g., build steps, starting services, OS-specific scripts, credentials).
5. **Annotation truncation notice:** Rendered whenever the 50-annotation cap was reached, reporting the number of omitted workflow annotations.
6. **Report location:** The path where the JSON report was written on the runner.

### Size limit & multi-byte safety

GitHub limits step summary files to 1 MiB. CloneProof enforces a conservative **512 KiB UTF-8 byte limit**:
- Measurement is based on raw UTF-8 byte length, not JavaScript string length.
- If content exceeds 512 KiB, output is safely truncated without splitting multi-byte Unicode sequences.
- Truncation snaps backwards to the nearest newline boundary and appends a visible truncation disclaimer.

### Environment handling & failure isolation

- If `GITHUB_STEP_SUMMARY` is not set (e.g., when testing the Action script locally), summary generation is gracefully skipped.
- Failures in the presentation layer (e.g., summary filesystem write errors) are caught safely and logged to `stderr`. They **never** crash the Action, alter the scan status, or change the CLI exit code.

---

## JSON report vs. Job Summary

- **JSON report (`report-path`):** The canonical, complete, machine-readable source of truth containing every check, finding, evidence item, and raw metadata.
- **Job Summary (`GITHUB_STEP_SUMMARY`):** A human-readable presentation intended for developer triage in the GitHub Actions UI.

> **Note on Artifact Uploads:** The JSON report is written to the runner's local filesystem (by default in a subfolder of `RUNNER_TEMP`). Files in runner temporary directories are **not** automatically uploaded as GitHub workflow artifacts. If your workflow needs to retain the JSON report as a downloadable artifact, use the official `actions/upload-artifact` step:

```yaml
      - name: Run CloneProof
        id: cloneproof
        uses: psuvraneel-cyber/Clone-Proof@main

      - name: Upload CloneProof Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cloneproof-report
          path: ${{ steps.cloneproof.outputs.report-path }}
```

---

## Security & isolation

- **Static inspection only:** The Action only invokes `cloneproof check`. It **never** executes repository code, lifecycle scripts (`npm install`, `preinstall`), README commands, or Docker containers.
- **Child process isolation:** The CLI is invoked via `child_process.spawn` using `process.execPath`, argument arrays, and `shell: false`. No host shell interpolation is used.
- **Environment filtering:** Only a minimal allowlist of necessary operating system environment variables (`PATH`, `TEMP`, `SYSTEMROOT`, etc.) is passed to the CLI child process. Runner tokens (`GITHUB_TOKEN`, `ACTIONS_RUNTIME_TOKEN`) and workflow secrets are strictly scrubbed.
- **Command injection defense:** Untrusted output from the child process is sanitized so it cannot emit raw `::` workflow commands. Workflow annotations are generated solely through a dedicated, percent-encoded formatter.
- **Markdown sanitization:** Untrusted finding messages, titles, codes, and paths are escaped to prevent Markdown and HTML injection in the Job Summary.
