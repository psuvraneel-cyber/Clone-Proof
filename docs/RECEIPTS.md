# Reproducibility receipts

A reproducibility receipt is a small, versioned JSON evidence record of one CloneProof run. It answers: which source revision was examined, which CloneProof version ran, how it was invoked, whether repository code ran (and where), what the outcome was, and whether cleanup was confirmed. A SHA-256 integrity digest over a canonical form lets anyone recompute and compare it.

**What a receipt is not.** It is not a security certification, a digital signature, an attestation, or SLSA provenance. A valid digest does not prove the source code is correct, that the recorded claims are true, or who produced the receipt. It documents what CloneProof recorded, not everything that could have happened in the environment. The JSON report remains the authoritative, detailed findings artifact.

## Producing a receipt

**CLI (opt-in).** Add `--receipt FILE` to `check` or `verify`:

```bash
cloneproof check . --format json --output report.json --receipt receipt.json
cloneproof verify . --docker --execute --receipt receipt.json
```

- The receipt is built from the finalized report (after cleanup), in the same process, without rescanning or rerunning Docker.
- Without `--receipt`, behavior and output are unchanged.
- `--receipt` and `--output` must name different files. The destination must not be a directory or a symbolic link; missing parent folders are created.
- The file is written atomically: a uniquely named temporary file in the same folder is written, flushed, and renamed. A failure never leaves a partial receipt.
- Receipt failures print `CloneProof: receipt was not created: …` and **do not change the exit code** or the report. Use `cloneproof receipt verify` (or check that the file exists) when a pipeline depends on the receipt.
- `verify` without `--docker --execute` produces no report and therefore no receipt.

**GitHub Action (always on).** Every Action run attempts a receipt. The default destination is `RUNNER_TEMP/cloneproof/receipt.json`; set `receipt-path` to choose another file inside `GITHUB_WORKSPACE` or `RUNNER_TEMP`. See [GITHUB_ACTION.md](GITHUB_ACTION.md#reproducibility-receipt).

## Verifying a receipt

```bash
cloneproof receipt verify receipt.json
```

The command reads the file as data (regular files only, at most 1 MiB), never executes anything, and:

1. parses JSON;
2. rejects any `receiptVersion` other than `1`;
3. validates the v1 JSON Schema and cross-field consistency rules;
4. removes `integrity`, recanonicalizes the rest, recomputes SHA-256, and compares it in constant time.

| Exit code | Meaning |
|---|---|
| `0` | Schema, consistency, and digest checks passed. |
| `1` | Valid JSON, but the schema, a consistency rule, or the digest check failed (each is labeled separately). |
| `2` | Invalid invocation, unreadable or oversized file, malformed JSON, or unsupported receipt version. |

## Integrity versus authenticity

The digest is computed as follows:

1. Build the receipt payload without `integrity`.
2. Serialize it with `cloneproof-canonical-json-v1` (below) and encode as UTF-8.
3. Compute SHA-256 and store `{ "algorithm": "sha256", "canonicalization": "cloneproof-canonical-json-v1", "digest": "<64 lowercase hex>" }`.

Because the digest never covers itself, verification simply drops `integrity` and repeats steps 2–3.

**Anyone who can edit a receipt can also recompute its digest.** The digest detects accidental corruption, and detects deliberate modification only when the expected digest is obtained from a separately trusted channel (for example, a value printed in a protected workflow log or Job Summary that you trust). Authenticity — who produced the receipt — requires a signature or attestation system, which is out of scope for receipt version 1.

## Canonical JSON (`cloneproof-canonical-json-v1`)

Compatible with RFC 8785 (JCS) for the value types receipts contain:

- Object keys are sorted by UTF-16 code units at every depth; input insertion order never matters.
- Arrays keep their order (finding order is meaningful).
- Strings and numbers use ECMAScript JSON serialization (deterministic escaping; `-0` becomes `0`).
- No insignificant whitespace.
- `undefined`, functions, symbols, `bigint`, `NaN`, `Infinity`, sparse arrays, non-plain objects (`Date`, `Map`, `Buffer`, class instances), and circular references are rejected instead of being dropped or coerced.

The file on disk is the same sorted structure pretty-printed with two-space indentation and a trailing newline. Formatting does not affect verification.

## Schema (version 1)

The schema is JSON Schema draft 2020-12 at [`schemas/receipt-v1.schema.json`](schemas/receipt-v1.schema.json). The copy shipped with the package (`src/receipt/receipt-v1.schema.json`) is what the CLI uses; a test keeps the two byte-identical. Every object uses `additionalProperties: false`, and all fields are required (optional data is `null`, never omitted).

| Field | Type | Notes |
|---|---|---|
| `receiptVersion` | `1` | Schema version. |
| `receiptType` | `"cloneproof.reproducibility"` | |
| `generatedAt` | string | UTC, millisecond precision, e.g. `2026-10-30T00:00:00.000Z`. The only time-dependent field. |
| `source.kind` | `local` \| `github` | Local folder or CloneProof-cloned public GitHub URL. |
| `source.repository` | `owner/name` \| null | GitHub targets: from the validated URL. Local targets: only in the Action, when the target's checkout root is `GITHUB_WORKSPACE` and `GITHUB_SERVER_URL` is `https://github.com`. |
| `source.url` | string \| null | Always `https://github.com/<repository>`; credentials can never appear. |
| `source.commit` | 40 lowercase hex \| null | Full SHA only. Short SHAs and branch names are never accepted as identity. |
| `source.ref` | `refs/(heads\|tags\|remotes\|pull)/…` \| null | Recorded only together with a resolved commit. |
| `source.subdirectory` | relative POSIX path \| null | Target folder relative to the checkout root (`.` for the root). |
| `source.revisionIdentity` | `commit` \| `unavailable` | |
| `source.identitySource` | `local-git-metadata` \| `cloneproof-github-clone` \| `none` | Where the commit came from. |
| `tool.name` / `tool.version` | `cloneproof` / semver | From `package.json` (currently `0.2.0`). |
| `tool.receiptGeneratorVersion` | `1` | |
| `tool.reportSchemaVersion` | `2` | The report schema the receipt was built from. |
| `tool.action` | `{ repository, ref }` \| null | Action only: `GITHUB_ACTION_REPOSITORY` / `GITHUB_ACTION_REF` when present and valid (null for `uses: ./`). |
| `execution.invocation` | `cli` \| `github-action` | |
| `execution.mode` | `check` \| `verify` | |
| `execution.verificationRequested` | boolean | `true` exactly in `verify` mode. |
| `execution.verificationAuthorized` | boolean | From `report.verification.authorized`. |
| `execution.repositoryCommandsExecuted` | boolean | `true` only when the report records a container exit code, timeout, or signal for an authorized run. |
| `execution.repositoryCommandsEnvironment` | `none` \| `controlled-docker` | |
| `execution.container` | object \| null | `image` (reference), `imageDigest` (`sha256:…` pinned in the reference, else null), `networkPolicy` (`none` \| `bridge` \| null), `timeoutMs`. Null in `check` mode. |
| `environment.runner` | `local` \| `github-hosted` \| `self-hosted` \| `github-actions` | `github-actions` when `RUNNER_ENVIRONMENT` is absent. |
| `environment.os` / `arch` / `nodeVersion` | enum / enum / `vX.Y.Z` | From the Node.js process. |
| `environment.github` | object \| null | `repository`, `workflow`, `runId`, `runAttempt`, `eventName`, `ref`, `workflowCommit` (`GITHUB_SHA`), `runnerOs`. Each is validated and set to null when malformed. Null outside GitHub Actions. |
| `result.status` | report status enum | Copied from the report. |
| `result.verificationOutcome` | `not_run` \| `passed` \| `failed` \| `blocked` \| `error` | Same mapping as the Action's `verification-status` output. |
| `result.summary` | counts | Copied from `report.summary` after checking it matches the findings. |
| `result.findings` | `[{ code, status }]` | Report order; no messages, evidence, paths, or output. |
| `result.cleanup` | `confirmed` \| `failed` \| `incomplete` \| `not_applicable` | From verification cleanup or GitHub clone cleanup; `not_applicable` for local static checks. |
| `coverage` | `{ checked, notChecked }` | Known coverage group IDs from the report. |
| `integrity` | object | See above. |

Consistency rules enforced in addition to the schema include: `check` mode has no container, no authorization, and `verificationOutcome: not_run`; `passed` requires executed commands; executed commands require authorization and `controlled-docker`; `imageDigest` must equal the digest embedded in `image`; the summary must equal the finding projection; a commit and `revisionIdentity`/`identitySource` must agree; and a CLI receipt has no Action identity.

## Source identity and its limits

- **Local targets** — CloneProof walks up from the target to the nearest `.git` (within `GITHUB_WORKSPACE` in the Action) and reads only `HEAD`, `commondir`, the referenced loose ref, and `packed-refs`, each with a byte limit. It starts no process and never consults Git configuration, hooks, aliases, or filters. Linked worktrees (`.git` files) are supported.
- The commit is the checked-out `HEAD`. **Uncommitted changes are not detected**, and the metadata is read after the scan, so a checkout changed mid-run is not detected either.
- SHA-256 object-format repositories (64-hex IDs) are recorded as unavailable.
- **GitHub targets** — the commit is the `rev-parse HEAD` value from CloneProof's isolated shallow clone, already validated in the report. The checked-out branch name is not recorded.
- In the Action, `environment.github.workflowCommit` is `GITHUB_SHA`, recorded separately. It is not used as `source.commit`, because the examined folder may be a different checkout.
- When identity cannot be established, the receipt says `unavailable`; the scan never fails because of it.

## Privacy

Receipts are built from an allow-list. Free text from reports (messages, titles, evidence, recommendations, stdout/stderr, omitted/ignored paths, cleanup details) never enters a receipt. Every string that does is checked against a strict pattern and replaced with `null` when it does not match. Receipts never contain tokens, secrets, `.env` content, absolute paths, temporary folder names, hostnames, usernames, IP addresses, Docker configuration, or environment dumps. Tests inject secret markers into every report field and environment variable a receipt could read, and check the receipt, its canonical bytes, error messages, CLI output, and the Job Summary.

## Examples

- [`examples/receipt-check.example.json`](examples/receipt-check.example.json) — static check through the Action.
- [`examples/receipt-verify.example.json`](examples/receipt-verify.example.json) — Docker verification through the Action.

Both are illustrative (fictional repository, fixed timestamp) and are verified by the test suite.
