# CloneProof demonstration script

This demo works without GitHub or internet access for the static inspection flow.

## 1. Show a healthy repository

```bash
node src/cli.js check examples/healthy-node
```

The report should end with `Status: passed` and show documented README commands, the lockfile, test script, runtime declarations, and the environment example as passing findings.

## 2. Show a broken repository

```bash
node src/cli.js check examples/broken-node
```

Point out the evidence-backed findings:

- missing lockfile;
- missing `scripts.test`, with the README test command attached as evidence;
- undocumented `APP_TOKEN`;
- conflicting Node runtime declarations.

If a repository contains nested packages or generated assets, point out that the root scan reports those boundaries explicitly instead of mixing them into the root application findings.

## 3. Show the machine-readable report

```bash
node src/cli.js check examples/broken-node --format json
```

Explain that the JSON report is suitable for CI or future GitHub comments and contains stable codes, relative paths, evidence, recommendations, and an overall status.

## 4. Show a self-contained HTML report

```bash
node src/cli.js check examples/healthy-node --format html --output reports/cloneproof-report.html
```

Open `reports/cloneproof-report.html` directly. It contains the summary, escaped findings, evidence details, recommendations, and any bounded Docker output without loading a server or external assets. The same `--output` option also accepts text and JSON.

For the optional remote-input demonstration, use a public repository URL:

```bash
node src/cli.js check https://github.com/psuvraneel-cyber/Clone-Proof --format json
```

CloneProof performs the public size/visibility preflight, then one isolated shallow bounded clone with no host Git config or credentials, and cleans the temporary clone parent after producing the report. Do not use private URLs or provide credentials.

## 5. Show execution safety

```bash
node src/cli.js verify examples/healthy-node
```

This must refuse to execute because `--docker --execute` is missing. On a Docker-capable machine, first make the fixed image available and then run:

```bash
docker pull node:22.19.0-bookworm-slim
node src/cli.js verify examples/healthy-node --docker --execute
```

If Docker is unavailable, CloneProof reports `blocked` and captures the reason instead of falling back to host execution. If the lockfile requires external packages while the network is disabled, the same command reports `DOCKER_NETWORK_REQUIRED` before starting a container. That behavior is expected and is part of the safety demonstration. Use `--allow-network` only for a repository you trust.
