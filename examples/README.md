# Demo repositories

These small repositories are intentionally checked into CloneProof so the demonstration is repeatable without GitHub or internet access.

## Healthy example

```bash
node src/cli.js check examples/healthy-node
```

This example has a package manifest, lockfile, documented commands, runtime declarations, an environment example, and a real Node test.

## Broken example

```bash
node src/cli.js check examples/broken-node
```

This example deliberately has a README command that is not defined, no test script, no lockfile, and an undocumented environment key. CloneProof should show those findings with evidence and recommendations.
