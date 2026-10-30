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

test('npm repository URLs normalize to GitHub owner/repo', () => {
  const { normalizeGithubRepository } = require('../scripts/fieldtest');
  assert.equal(normalizeGithubRepository('https://github.com/microsoft/TypeScript'), 'microsoft/TypeScript');
  assert.equal(normalizeGithubRepository('git+https://github.com/lodash/lodash.git'), 'lodash/lodash');
  assert.equal(normalizeGithubRepository('git://github.com/isaacs/rimraf.git'), 'isaacs/rimraf');
  assert.equal(normalizeGithubRepository('git@github.com:chalk/chalk.git'), 'chalk/chalk');
  assert.equal(normalizeGithubRepository('ssh://git@github.com/a/b.git'), 'a/b');
  assert.equal(normalizeGithubRepository('http://www.github.com/a/b/'), 'a/b');
  assert.equal(normalizeGithubRepository('https://github.com/babel/babel/tree/main/packages/babel-core'), 'babel/babel');
  assert.equal(normalizeGithubRepository('https://github.com/a/b#readme'), 'a/b');
  assert.equal(normalizeGithubRepository('https://gitlab.com/a/b'), null);
  assert.equal(normalizeGithubRepository('https://github.com/a'), null);
  assert.equal(normalizeGithubRepository(''), null);
  assert.equal(normalizeGithubRepository(null), null);
});

test('top-package selection de-duplicates repositories and records skips', () => {
  const { selectTopRepositories } = require('../scripts/fieldtest');
  const packages = [
    { rank: 1, name: 'typescript', repositoryUrl: 'https://github.com/microsoft/TypeScript' },
    { rank: 2, name: '@types/node', repositoryUrl: 'https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node' },
    { rank: 3, name: 'gone', repositoryUrl: 'https://github.com/x/gone' },
    { rank: 4, name: '@types/react', repositoryUrl: 'git+https://github.com/definitelytyped/definitelytyped.git' },
    { rank: 5, name: 'elsewhere', repositoryUrl: 'https://gitlab.com/a/b' },
    { rank: 6, name: 'nourl', repositoryUrl: null },
    { rank: 7, name: 'old', repositoryUrl: 'https://github.com/old-owner/thing' },
    { rank: 8, name: 'renamed', repositoryUrl: 'https://github.com/new-owner/thing' },
    { rank: 9, name: 'gone-too', repositoryUrl: 'https://github.com/x/gone.git' },
    { rank: 10, name: 'late', repositoryUrl: 'https://github.com/a/late' },
    { rank: 11, name: 'after', repositoryUrl: 'https://github.com/a/after' }
  ];
  const calls = [];
  const inspect = (ownerRepo) => {
    calls.push(ownerRepo);
    if (ownerRepo === 'x/gone') return { rejected: 'not-found' };
    const fullName = { 'definitelytyped/definitelytyped': 'DefinitelyTyped/DefinitelyTyped', 'old-owner/thing': 'new-owner/thing' }[ownerRepo] || ownerRepo;
    return { fullName, facts: { repository: fullName } };
  };
  const { sample, skipped } = selectTopRepositories(packages, 4, inspect);
  assert.deepEqual(sample.map((facts) => [facts.rank, facts.package, facts.repository, facts.alsoProvides]), [
    [1, 'typescript', 'microsoft/TypeScript', []],
    [2, '@types/node', 'DefinitelyTyped/DefinitelyTyped', ['@types/react']],
    [7, 'old', 'new-owner/thing', ['renamed']],
    [10, 'late', 'a/late', []]
  ]);
  assert.deepEqual(skipped.map((entry) => [entry.rank, entry.reason]), [[3, 'not-found'], [5, 'not-github'], [6, 'no-repository-url']]);
  assert.deepEqual(skipped[0].alsoProvides, ['gone-too']);
  assert.ok(!calls.includes('a/after'), 'selection stops once the count is reached');
  assert.equal(calls.filter((name) => name === 'x/gone').length, 1, 'each repository is inspected once');
});
