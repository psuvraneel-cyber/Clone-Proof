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

Verify the supported npm workflow in Docker. Both flags are required; without them CloneProof never executes repository code:

```bash
node src/cli.js verify ./path/to/repository --docker --execute
```

The default container network is disabled. If dependency installation genuinely needs registry access, make that decision explicit. This enables the network for both dependency installation and the declared test workflow, so only use it for repositories you trust:

```bash
node src/cli.js verify ./path/to/repository --docker --execute --allow-network
```

Use `--timeout-ms N` to override the bounded verification timeout when a trusted project needs more time. The value is capped internally at ten minutes.

CloneProof uses a fixed Node 22.19.0 image, refuses to pull it implicitly, ignores npm lifecycle scripts during `npm ci`, runs the declared `npm test` script only after explicit authorization, and never falls back to host execution. On a Docker-capable machine, make the image available first:

```bash
docker pull node:22.19.0-bookworm-slim
```

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

This CLI has no hosted deployment target. For submission, publish the repository publicly on the connected GitHub account; for local use, run it from the checkout or build the included Docker image.

## Docker build

On a Docker-capable machine:

```bash
docker build -t cloneproof .
docker run --rm --network none cloneproof
```

The container runs CloneProof's static inspection against the project copy. Target-repository verification is intentionally separate and uses a temporary, read-only source snapshot with bounded CPU, memory, process count, output, and wall-clock time. CloneProof does not run a target Dockerfile or accept arbitrary Docker flags.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the trust boundaries and module plan. See [docs/DECISIONS.md](docs/DECISIONS.md) for important implementation decisions and the current OmniRush session record.

## Security and limitations

- Static inspection does not execute repository-defined scripts, README commands, lifecycle hooks, Dockerfiles, or shell commands.
- Target repositories are untrusted input. Symlinks, malformed files, large files, and incomplete scans are handled explicitly.
- Docker is not a complete security boundary. Execution verification is opt-in, bounded, and a reproducibility experiment rather than a safety certification.
- Real `.env` files, npm configuration files, and other sensitive environment configuration are excluded from the staged container snapshot. The host environment and Docker socket are not mounted.
- The current image is pinned to a version tag rather than a digest. A future release should record and verify a trusted digest for stronger supply-chain guarantees.
- The first release focuses on the root package of Node.js/TypeScript repositories. Monorepos, pnpm/Yarn execution, private repositories, and external services may be reported as unsupported or blocked.

## Buildathon

The official requirements checklist is recorded in [docs/BUILDATHON_CHECKLIST.md](docs/BUILDATHON_CHECKLIST.md). The official source is <https://omnirush.ai/buildathon>.
