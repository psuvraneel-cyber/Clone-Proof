# CloneProof

CloneProof is an evidence-based repository setup verification tool for Node.js and TypeScript projects. It helps maintainers find the problems that would prevent another developer from getting their project running.

CloneProof does not claim to prove that code is safe or that a repository is universally reproducible. It reports what it can verify, the evidence behind each finding, and when a check is blocked or incomplete.

## Current status

The project is being built as an OmniRush Frontier Buildathon submission. The first vertical slice is the deterministic static inspector. Docker-based execution verification is a separate, explicitly enabled mode and depends on a Docker-capable environment.

## Requirements

- Node.js 22.19.0 or newer (the project pins 22.19.0 in `.nvmrc`).
- npm.
- Docker is only required for the optional execution-verification workflow.

## Setup

```bash
npm ci
```

No secrets are required for local inspection. `.env.example` is included as a safe template for future optional integrations.

## Usage

Inspect a repository without executing its code:

```bash
node src/cli.js check ./path/to/repository
```

Request JSON output:

```bash
node src/cli.js check ./path/to/repository --format json
```

The intended installed command is also available after `npm link`:

```bash
cloneproof check ./path/to/repository
```

Docker verification will require both `--docker` and `--execute`. CloneProof will never silently fall back to running repository commands on the host.

## Test and build

The canonical offline test command is:

```bash
npm test
```

On Linux, the Buildathon-friendly wrapper is:

```bash
make test
```

Build syntax-checks the source files:

```bash
npm run build
```

## Docker build

On a Docker-capable machine:

```bash
docker build -t cloneproof .
docker run --rm --network none cloneproof
```

The container runs CloneProof's static inspection against the project copy. The target-repository execution profile is intentionally separate and will document its network, filesystem, resource, and consent controls before it is enabled.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the trust boundaries and module plan. See [docs/DECISIONS.md](docs/DECISIONS.md) for important implementation decisions and the current OmniRush session record.

## Security and limitations

- Static inspection does not execute repository-defined scripts, README commands, lifecycle hooks, Dockerfiles, or shell commands.
- Target repositories are untrusted input. Symlinks, malformed files, large files, and incomplete scans are handled explicitly.
- Docker is not a complete security boundary. Execution verification will be opt-in, bounded, and documented as a reproducibility experiment rather than a safety certification.
- The first release focuses on the root package of Node.js/TypeScript repositories. Monorepos, pnpm/Yarn execution, private repositories, and external services may be reported as unsupported or blocked.

## Buildathon

The official requirements checklist is recorded in [docs/BUILDATHON_CHECKLIST.md](docs/BUILDATHON_CHECKLIST.md). The official source is <https://omnirush.ai/buildathon>.
