# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | Yes |
| 0.1.x | No; upgrade to 0.2 |
| Earlier untagged `main` snapshots | No; upgrade to the latest release |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it
privately through GitHub: go to the repository's **Security** tab and choose
**Report a vulnerability**. Include the CloneProof version, the command or
Action configuration, and the smallest repository or input that reproduces
the problem.

You can expect an acknowledgement within 7 days. Fixes are released as a new
patch version, and the advisory is published once a fixed release is available.

## What counts as a vulnerability

CloneProof treats every target repository as untrusted input. Reports are
especially welcome when a crafted repository can:

- make `check` execute repository-controlled code or start a process for a
  local target;
- escape the `verify` container profile, reach the network without
  `--allow-network`, or read host secrets or files outside the staged copy;
- make the GitHub Action run Docker verification for an untrusted event such
  as `pull_request`, or inject workflow commands into the runner;
- leak tokens, absolute host paths, or other private data into reports,
  receipts, annotations, or the Job Summary.

Docker itself is not a complete security boundary. `verify` is a
reproducibility check, not a sandbox for hostile code; see
[docs/SECURITY.md](docs/SECURITY.md) for the full trust model and its documented
limits.
