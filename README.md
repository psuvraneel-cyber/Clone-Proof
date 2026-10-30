<div align="center">

# CloneProof

**Find out whether a fresh clone of your Node.js / TypeScript repo actually sets up and runs — with evidence.**

[![CI](https://github.com/psuvraneel-cyber/Clone-Proof/actions/workflows/ci.yml/badge.svg)](https://github.com/psuvraneel-cyber/Clone-Proof/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-43853d)
![License](https://img.shields.io/badge/license-MIT-blue)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

[Quick start](#quick-start) · [What it catches](#what-it-catches) · [How it stays safe](#how-it-stays-safe) · [Results & exit codes](#results-and-exit-codes) · [Field-tested](#field-tested)

</div>

---

> **"It works on my machine."** Then someone clones your repo, follows the README… and it doesn't run.
> A missing lockfile. No test script. An environment variable nobody wrote down. Node 22 in `.nvmrc`, Node 20 in the Dockerfile.

CloneProof finds those problems **before a newcomer does**. Point it at a local folder or a public GitHub URL and it reports every setup problem it can prove — each one with the file, the line, and a fix.

- 🔍 **`check`** — a read-only static scan. It **never runs the repository's code**.
- 🐳 **`verify --docker --execute`** — opt-in proof: runs `npm ci --ignore-scripts` and `npm test` inside a pinned, locked-down container.
- 📄 **Reports** in text, JSON, or a self-contained HTML file, with CI-friendly exit codes.

CloneProof doesn't claim a repo is "safe" or universally reproducible. It reports what it verified, the evidence behind each finding, and what it did **not** check.

---

## Quick start

**Requirements:** Node.js ≥ 22.19.0 and npm. Docker is only needed for `verify`.

```bash
# Install the v0.1.0 release tarball (built and attested by CI)
npm install -g https://github.com/psuvraneel-cyber/Clone-Proof/releases/download/v0.1.0/cloneproof-0.1.0.tgz

# Check a project folder (read-only, no network, no code execution)
cloneproof check ./my-project

# Check a public GitHub repository
cloneproof check https://github.com/tj/commander.js
```

Or run it once without installing:

```bash
npx github:psuvraneel-cyber/Clone-Proof#v0.1.0 check ./my-project
```

> ⚠️ Don't run `npm install -g cloneproof`. That npm name belongs to a **different project**, so install from the URL above.

To check the download before installing, fetch the tarball and `SHA256SUMS` from the [v0.1.0 release](https://github.com/psuvraneel-cyber/Clone-Proof/releases/tag/v0.1.0), then:

```bash
sha256sum -c SHA256SUMS
gh attestation verify cloneproof-0.1.0.tgz --repo psuvraneel-cyber/Clone-Proof
npm install -g ./cloneproof-0.1.0.tgz
```

The tarball contains only `src/`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`, and has no dependencies. Changes between versions are in the [changelog](CHANGELOG.md).

### GitHub Actions

Run CloneProof automatically in CI using the native GitHub Action (`node24`):

```yaml
- name: Run CloneProof Static Check
  uses: psuvraneel-cyber/Clone-Proof@v0.1.0
  with:
    target-path: '.'
    mode: 'check' # default: read-only static scan
```

Pin a release tag such as `@v0.1.0`, or the release's full commit SHA for supply-chain-sensitive workflows (`uses: psuvraneel-cyber/Clone-Proof@<commit-sha> # v0.1.0`). Don't use `@main`: it changes with every merge. While the version is `0.x` there is no moving major tag, so upgrades are always explicit; see [Releases](https://github.com/psuvraneel-cyber/Clone-Proof/releases) and the [changelog](CHANGELOG.md).

To run controlled container verification on trusted branches:

```yaml
- name: Run CloneProof Docker Verification
  uses: psuvraneel-cyber/Clone-Proof@v0.1.0
  with:
    target-path: '.'
    mode: 'verify' # runs static check + hardened Docker verification
    allow-network: 'false' # default: network isolated (--network=none)
    timeout-ms: '300000' # default: 5 minutes (max 600000)
```

The Action integrates natively with GitHub Actions features:
- **Two execution modes:** `check` for deterministic static analysis (safe on all PRs) and `verify` for controlled Docker verification (restricted to Linux runners on `push` and `workflow_dispatch` events).
- **Pull request & workflow annotations:** High-priority findings appear inline in file diffs and workflow logs (`error`, `warning`, `notice` capped at 10 each, 30 max total).
- **GitHub Actions Job Summary:** A structured Markdown summary showing status, metrics, findings table, Docker verification outcome (in `verify` mode), evaluated check groups, and safe logical report locations.
- **Fail-safe isolation:** Child process secrets are scrubbed, untrusted child output cannot inject workflow commands, non-Linux runners and untrusted PR events fail closed without running repository code on the host, and presentation errors never alter scan results.
- **Reproducibility receipt:** Every run writes a versioned JSON receipt (default `RUNNER_TEMP/cloneproof/receipt.json`) recording the source commit, CloneProof version, mode, runner, Docker image and network policy, outcome, and cleanup, with a SHA-256 integrity digest. Outputs `receipt-path` and `receipt-status` expose it.

See [docs/GITHUB_ACTION.md](docs/GITHUB_ACTION.md) for complete input, output, annotation, Docker verification, and job summary documentation.

Want proof that install and tests really work?

```bash
cloneproof setup                                            # one-time: prepare the pinned verifier image
cloneproof verify ./my-project --docker --execute           # network off by default
cloneproof verify ./my-project --docker --execute --allow-network   # only for repos you trust
```

---

## What it looks like

Real output from the included broken example (`cloneproof check examples/broken-node`):

```text
CloneProof — repository setup verification
Target: broken-node
Status: failed

Finding counts:
  Total: 9
  Passed: 5
  Failed: 1
  Warnings: 3

[FAIL] TEST_SCRIPT_MISSING — The package test script is missing
  Message: package.json does not define a non-empty scripts.test entry.
  Evidence:
    - package.json — scripts.test is missing or empty.
    - README.md:7 — README references npm run test.
  Recommendation: Add a deterministic scripts.test command that runs the repository test suite.

[WARN] RUNTIME_VERSION_MISMATCH — Runtime declarations disagree
  Message: Node.js declarations contain multiple major versions (20, 22).
  Evidence:
    - .nvmrc — Runtime declared in .nvmrc. Found 22.19.0.
    - Dockerfile — Node base image declaration. Found 20.0.0.
    - package.json — Exact engines.node runtime declaration. Found 20.0.0.
```

Exit code `1` — so a CI pipeline stops right there.

Try both included examples yourself:

```bash
cloneproof check examples/healthy-node     # passed, exit 0
cloneproof check examples/broken-node      # failed, exit 1
```

---

## What it catches

| Problem a newcomer hits | Example finding |
|---|---|
| No lockfile, so versions drift | `LOCKFILE_MISSING` |
| Lockfile out of sync with `package.json`, or several conflicting lockfiles | lockfile validity / sync findings |
| `packageManager` disagrees with the lockfile | `PACKAGE_MANAGER_LOCKFILE_MISMATCH` |
| No `npm test`, or a placeholder test script | `TEST_SCRIPT_MISSING` |
| README tells you to run a script that doesn't exist | `README_SCRIPT_UNKNOWN` |
| Code reads env variables nobody documented | `ENV_EXAMPLE_MISSING` (with `file:line` for each reference) |
| `.nvmrc`, `engines.node` and the Dockerfile disagree | `RUNTIME_VERSION_MISMATCH` |
| A core file (like the lockfile) is gitignored | `CORE_FILE_GITIGNORED` |
| Build output referenced but not committed | `BUILD_OUTPUT_MISSING` (info) |
| Needs a database, cache or broker | `SERVICES_LIKELY_REQUIRED` (info) |
| Private registry or Git-hosted dependencies | `PRIVATE_REGISTRY`, `GIT_DEPENDENCIES` |
| `verify`: tests "pass" but **zero tests ran** | `VERIFY_NO_TESTS_RAN` — reported as **failed** |

Every report also lists **what was not checked** (build steps, starting services, OS-specific scripts, registry credentials, non-README docs, browser/native-build tests), so a `passed` result never overclaims.

<details>
<summary><b>All check groups</b></summary>

| ID | Check group |
|---|---|
| `package-manifest` | Package manifest |
| `lockfile-presence-validity-sync` | Lockfile presence, validity, and synchronization |
| `package-manager-consistency` | Package-manager consistency |
| `test-script` | Test script |
| `readme-npm-commands` | README npm commands and setup-manager consistency |
| `env-documentation` | Environment documentation |
| `node-runtime-declarations` | Node runtime declarations |
| `gitignored-core-files` | Gitignored core files |
| `install-scripts` | Install scripts that the Docker profile intentionally skips |
| `browser-tests` | Browser tooling reachable from the test workflow |
| `nested-packages` | Nested package boundaries |
| `project-classification` | Project classification |
| `package-sources` | Package registries and Git dependency hosts |
| `build-output` | Declared build output files |
| `service-indicators` | Compose files and service dependency indicators |

See [docs/FINDINGS.md](docs/FINDINGS.md) for the complete finding-code reference, status and severity definitions, and finding-to-check-group mappings.

The JSON report's `coverage.checked` lists the groups actually attempted for that target, and `coverage.notChecked` the fixed out-of-scope list.

</details>

<details>
<summary><b>Notable finding codes and how noise is kept down</b></summary>

- `VERIFY_NO_TESTS_RAN` — `npm test` exited `0`, but the output matched a zero-test result (node:test, Jest, Vitest, Mocha, AVA, tap). Reported as a **failed** verification with the matched line as evidence.
- `GIT_METADATA_REQUIRED` — a `pretest`/`test`/`posttest` script depends on `.git`, which the Docker snapshot removes. Info during `check`, warning during `verify`.
- `PACKAGE_MANAGER_UNRECOGNIZED` — `packageManager` names something other than npm, pnpm, Yarn or Bun. Advisory, not a failure.
- `MONOREPO_ROOT_TEST_SCRIPT_MISSING` — a workspace root has no root test script; nested packages may own the tests. Advisory.

Environment warnings skip example, fixture, mock, docs, benchmark, perf, tooling and CI scopes at any depth, plus conventional CI/test-tool prefixes (`CI_*`, `GITHUB_*`, `JEST_*`, `PLAYWRIGHT_*`, `BROWSERSTACK_*`, …). A variable with a literal fallback (`process.env.PORT ?? "3000"`) or a destructuring default counts as optional — but only if *every* reference has one. `AZURE_*` is deliberately **not** skipped, because keys like `AZURE_STORAGE_CONNECTION_STRING` are real app settings.

</details>

---

## How it stays safe

Target repositories are treated as **untrusted input**.

**`check` (static)**
- Never runs repository scripts, README commands, lifecycle hooks, Dockerfiles or shell commands. Local scans start no process at all.
- Refuses home folders and drive roots (`WRONG_TARGET`); scans are bounded and report `SCAN_ENTRY_LIMIT_EXCEEDED` instead of hanging.
- Symlinks are skipped; malformed and oversized files are handled explicitly.

**GitHub targets**
- Only public `https://github.com/OWNER/REPO` URLs. A size/visibility preflight blocks private, missing, or >4 GiB repositories **before** cloning.
- One shallow clone into an isolated temp folder, using an **empty Git config**: no credential helpers, no LFS smudging, no host Git settings. Pinned to the exact commit, and deleted afterwards.
- An optional `CLONEPROOF_GITHUB_TOKEN` / `GITHUB_TOKEN` is used **only** for the API preflight, never passed to Git or Docker, and never written to reports or logs.

**`verify` (opt-in execution)**
- Requires **both** `--docker` and `--execute`. Without them, nothing executes.
- Pinned image `node:22.19.0-bookworm-slim@sha256:4a48…2b90`, never pulled implicitly (`--pull=never`).
- Non-root user (UID/GID 1000), dropped capabilities, `no-new-privileges`, **read-only** source mount, no Docker socket, no host environment.
- **Network off** by default; `--allow-network` is a separate, explicit choice.
- Limits: 1 CPU, 2 GiB memory, 512 processes, 512 MiB `/tmp`, 1 GiB `/workspace`, 5-minute default timeout (`--timeout-ms`, capped at 10 minutes), bounded output.
- `npm ci --ignore-scripts`, so lifecycle scripts never run. Local `.env`, `.npmrc` and key files are left out of the staged copy.
- Containers and temp folders are cleaned up even after Ctrl+C or a hard kill.

> Docker is not a complete security boundary. `verify` is a reproducibility experiment, not a safety certification.

---

## Results and exit codes

| Status | `check` meaning | `verify` meaning | Exit |
|---|---|---|:-:|
| `passed` | No known problem in the checks that ran — not a guarantee | `npm ci` and `npm test` succeeded in the container | `0` |
| `passed_with_warnings` | Completed; advisory findings to review | Succeeded, with static warnings or omitted local files | `0` |
| `failed` | A blocking finding (e.g. missing test script, out-of-sync lockfile) | Install or tests failed, **zero tests ran**, or cleanup wasn't confirmed | `1` |
| `blocked` | Safely refused: unsupported root, private repo, invalid URL, limits | Missing consent, Docker, image, network consent, or symlink policy | `2` |
| `incomplete` | Something couldn't be inspected completely | Source couldn't be scanned or staged completely | `2` |

---

## Usage reference

```text
cloneproof check  <path-or-github-url> [--format text|json|html] [--output FILE] [--receipt FILE] [--color|--no-color]
cloneproof verify <path-or-github-url> --docker --execute [--allow-network] [--timeout-ms N]
                                       [--format text|json|html] [--output FILE] [--receipt FILE] [--color|--no-color]
cloneproof setup
cloneproof receipt verify <receipt-file>
cloneproof --version
```

| Option | What it does |
|---|---|
| `--format text\|json\|html` | Text for people, canonical JSON for CI, self-contained HTML to share |
| `--output FILE` | Write the report to a file (creates missing folders) |
| `--color` / `--no-color` | Terminal color preference; `NO_COLOR` always disables it |
| `--docker --execute` | Both required to run anything in `verify` |
| `--allow-network` | Allow network in the container — trusted repos only |
| `--timeout-ms N` | Verification time limit (default 5 min, max 10 min) |
| `--receipt FILE` | Also write a reproducibility receipt (opt-in; must differ from `--output`) |

**Reproducibility receipts.** `--receipt FILE` writes a separate, versioned JSON evidence record of the run: source commit (read from local Git metadata without running Git, or from CloneProof's GitHub clone), CloneProof version, mode, whether repository commands ran and where, Docker image digest and network policy, outcome, finding codes, coverage, and cleanup. It carries a SHA-256 digest over a canonical JSON form. `cloneproof receipt verify FILE` checks the schema and digest (exit `0` valid, `1` invalid or mismatched, `2` unreadable or unsupported). A receipt is **not** a signature or a security certification: anyone who can edit it can recompute the digest, so the digest only detects changes when you trust the expected value from elsewhere. Receipt failures are reported separately and never change the exit code. See [docs/RECEIPTS.md](docs/RECEIPTS.md).

**GitHub URLs:** `https://github.com/OWNER/REPO` works, including variants with `www.`, a trailing `/`, `?tab=…` or `#readme`. `/tree/…` and `/blob/…` links are rejected with the correct URL suggested. A missing local path shaped like `owner/repo` gets a "Did you mean https://github.com/owner/repo?" hint.

**Reports are deterministic:** relative paths only, no timestamps, sorted, so the same repo at the same commit gives byte-identical JSON every time. The HTML report has no scripts and makes no external requests, so it's safe to attach to an issue or a PR.

Working from a clone of this repo instead of a global install? Replace `cloneproof` with `node src/cli.js`.

---

## Field-tested

Full commands, target commits and per-finding verdicts are in [docs/FIELD_TEST.md](docs/FIELD_TEST.md).

| Measure | Result |
|---|---:|
| Random sample, pre-registered (Run 5, 50 repos) | 13 failed (exit 1), 36 passed, 1 incomplete |
| Blocking findings, Run 5 | **14 / 14 factually correct**; 4 / 14 actionable, 10 were "this repo has no tests" |
| Warnings, Run 5 | 8 / 26 real (**30.8%**); 13 / 26 false, mostly `ENV_EXAMPLE_MISSING` and `BROWSER_TESTS_DETECTED` |
| Hand-picked repositories (Run 3) | **13 correct + 2 environment-limited** out of 15; warning precision 5 / 6 |
| Planted-bug mutations (offline) | **13 / 13** detected |
| Planted bugs in real repositories | **39 / 39** detected across 3 repos |
| Automated tests | **419** (offline, `npm test`) |
| CI | Ubuntu · macOS · Windows · Docker end-to-end · GitHub Action end-to-end |
| Output determinism | Byte-identical JSON across repeated runs on 10 public repos |

Run 5 is the honest noise measurement. Blocking findings were never wrong, but most fired on repositories that have no tests at all. Two warning checks (`ENV_EXAMPLE_MISSING`, `BROWSER_TESTS_DETECTED`) are noisy in the wild and are the next fixes. In Run 3, the two environment-limited cases are expected by design: native modules whose install scripts are skipped, and browser tests that the controlled image can't run.

---

## Limitations

- Focused on the **root package** of Node.js / TypeScript repos. Monorepo sub-packages are listed and can be checked one at a time.
- `verify` supports **npm** only; pnpm, Yarn and Bun projects are checked statically but blocked from execution.
- Only the root `.gitignore` (and `.git/info/exclude`) is read.
- Repositories that commit symlinks are blocked from `verify`.
- No private repositories, and it doesn't start external services or run build steps.
- Mixed-language repos work when the root has a `package.json`; a Python/Go/Rust/Java root is reported as `UNSUPPORTED_ROOT`.

---

## Development

```bash
git clone https://github.com/psuvraneel-cyber/Clone-Proof.git
cd Clone-Proof
npm ci
npm test               # 419 offline tests
npm run test:leaks     # same suite with an isolated temp folder; fails on any leftover file
npm run build          # syntax check
```

Docker image of CloneProof itself:

```bash
docker build -t cloneproof .
docker run --rm --network none cloneproof
```

No secrets are needed; `.env.example` is a placeholder template only.

**Project docs:** [Architecture](docs/ARCHITECTURE.md) · [Security model](docs/SECURITY.md) · [Design decisions](docs/DECISIONS.md) · [Field tests](docs/FIELD_TEST.md) · [Finding codes](docs/FINDINGS.md) · [GitHub Action](docs/GITHUB_ACTION.md) · [Releasing](docs/RELEASING.md) · [Changelog](CHANGELOG.md) · [Demo script](docs/DEMO.md)

---

## Roadmap

- pnpm and Yarn verification profiles
- Detect OS-specific setup and scripts
- Stronger isolation (gVisor or a dedicated VM)
- A size watchdog during clones
- Safe symlink recreation inside the container
- Reduce the noise measured in field test Run 5: committed `.env.*` files and framework built-ins for environment checks, browser detection based on the selected test configuration, and a non-blocking result for repositories with no tests

---

## Built for the OmniRush Frontier Buildathon 2026

Track: **Developer Tools & Open Source**. Requirements checklist: [docs/BUILDATHON_CHECKLIST.md](docs/BUILDATHON_CHECKLIST.md) · Event: <https://omnirush.ai/buildathon>

## License

[MIT](LICENSE)
