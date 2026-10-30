const test = require('node:test');
const assert = require('node:assert/strict');

const { clusterBootstrap, expectedFindings, mulberry32, parseManifest, testScriptKind, wilson } = require('../scripts/fieldtest');

function facts(overrides) {
  return {
    packageJsonValid: true,
    testScript: 'present',
    workspaces: false,
    packageManager: null,
    lockfiles: ['package-lock.json'],
    ...overrides
  };
}

test('the field-test sampler PRNG is deterministic for a seed', () => {
  const first = mulberry32(20261030);
  const second = mulberry32(20261030);
  const values = Array.from({ length: 5 }, () => first());
  assert.deepEqual(values, Array.from({ length: 5 }, () => second()));
  assert.ok(values.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(values, Array.from({ length: 5 }, mulberry32(1)));
});

test('test scripts are classified as missing, placeholder, or present', () => {
  assert.equal(testScriptKind(undefined), 'missing');
  assert.equal(testScriptKind('  '), 'missing');
  assert.equal(testScriptKind('echo "Error: no test specified" && exit 1'), 'placeholder');
  assert.equal(testScriptKind('node --test'), 'present');
});

test('pre-registered expectations follow the documented rules', () => {
  assert.deepEqual(expectedFindings(facts({})), []);
  assert.deepEqual(expectedFindings(facts({ packageJsonValid: false, testScript: 'missing' })), ['PACKAGE_JSON_INVALID']);
  assert.deepEqual(expectedFindings(facts({ testScript: 'missing' })), ['TEST_SCRIPT_MISSING']);
  assert.deepEqual(expectedFindings(facts({ testScript: 'missing', workspaces: true })), ['MONOREPO_ROOT_TEST_SCRIPT_MISSING']);
  assert.deepEqual(expectedFindings(facts({ testScript: 'placeholder', lockfiles: [] })), ['LOCKFILE_MISSING', 'TEST_SCRIPT_PLACEHOLDER']);
  assert.deepEqual(expectedFindings(facts({ packageManager: 'pnpm@9.0.0' })), ['PACKAGE_MANAGER_LOCKFILE_MISMATCH']);
  assert.deepEqual(expectedFindings(facts({ packageManager: 'npm@10.0.0' })), []);
  assert.deepEqual(expectedFindings(facts({ packageManager: 'pnpm@9.0.0', lockfiles: ['pnpm-lock.yaml', 'package-lock.json'] })), []);
});

test('Wilson intervals bound the observed proportion', () => {
  assert.equal(wilson(0, 0), null);
  const [low, high] = wilson(5, 6);
  assert.ok(low > 0.43 && low < 0.44, `low ${low}`);
  assert.ok(high > 0.96 && high < 0.98, `high ${high}`);
  assert.deepEqual(wilson(0, 10).map((value) => Number(value.toFixed(4))), [0, 0.2775]);
});

test('only JSON objects count as package manifests', () => {
  assert.deepEqual(parseManifest('{"name":"x"}'), { name: 'x' });
  for (const text of ['[]', '[{"name":"x"}]', '"x"', '42', 'null', 'true', '{oops']) {
    assert.equal(parseManifest(text), null, text);
  }
});

test('the cluster bootstrap resamples repositories deterministically', () => {
  const clusters = [
    { successes: 2, total: 2 },
    { successes: 0, total: 1 },
    { successes: 1, total: 3 },
    { successes: 0, total: 0 }
  ];
  const first = clusterBootstrap(clusters, { iterations: 2000 });
  assert.deepEqual(first, clusterBootstrap(clusters, { iterations: 2000 }));
  assert.ok(first[0] <= 3 / 6 && 3 / 6 <= first[1], `interval ${first} should contain the point estimate`);
  assert.ok(first[0] >= 0 && first[1] <= 1);
  assert.equal(clusterBootstrap([{ successes: 0, total: 0 }]), null);
});
