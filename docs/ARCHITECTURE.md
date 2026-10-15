# CloneProof architecture

CloneProof is a local, command-line-first tool. The first release separates two trust levels:

1. **Static inspection (`check`)** reads repository files and never starts a repository-defined process.
2. **Execution verification (`verify`)** is opt-in and will use a CloneProof-controlled Docker profile with explicit consent.

## First vertical slice

The first slice targets the root of a Node.js or TypeScript repository. It reads `README.md`, `package.json`, npm lockfiles, runtime declarations, test files, and environment-variable references. It emits one versioned report schema in either readable text or JSON.

## Module boundaries

```text
src/
  cli.js                 argument parsing and exit codes
  scan/                  bounded filesystem scan and deterministic rules
  report/                report schema and terminal/JSON rendering
  verify/                explicit Docker execution boundary
```

The scanner returns data. Rules turn that data into evidence-backed findings. Report renderers do not perform checks. This makes the checks deterministic and keeps the execution boundary obvious.

## Security assumptions

- A target repository is untrusted input.
- Static mode must not invoke `node`, `npm`, a shell, Git, or Docker.
- Symlinks are reported and not followed by default.
- Scan size, depth, file count, and individual file size are bounded.
- Report paths are relative to the target root; machine-specific absolute paths are not part of canonical JSON.
- Docker verification is not a guarantee that a repository is safe. It is a bounded reproducibility experiment and will document its limitations.

## Planned Docker profile

The execution mode will not trust a target Dockerfile or arbitrary Docker flags. It will use an application-controlled container command, explicit resource limits, a scrubbed environment, a read-only source mount, and a visible network policy. It will refuse to fall back to host execution when Docker is unavailable.
