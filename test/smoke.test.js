const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('CLI exposes the safe-by-default help message', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Static check never executes repository code/);
  assert.match(result.stdout, /Docker verification network access is disabled/);
  assert.match(result.stdout, /--color\|--no-color/);
  assert.match(result.stdout, /NO_COLOR always disables ANSI color/);
  assert.equal(result.stderr, '');
});
