'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { inspectCheckout } = require('../src/input/github');
const { scanRepository } = require('../src/scan/repository');
const {
  setupDockerImage,
  verifyRepository
} = require('../src/verify/docker');

const SOURCE_ROOT = path.join(__dirname, '..', 'src');
const healthyFixture = path.join(__dirname, '..', 'examples', 'healthy-node');

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-finding-codes-'));
  writeFile(root, 'package.json', JSON.stringify({
    name: 'finding-code-fixture',
    packageManager: 'npm@10.8.2',
    engines: { node: '>=22.0.0' },
    scripts: {
      build: 'node build.js',
      start: 'node server.js',
      test: 'node --test'
    }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"finding-code-fixture","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, 'README.md', [
    '# Finding-code fixture',
    '',
    '```sh',
    'npm ci',
    'npm test',
    'npm start',
    'npm run build',
    '```',
    ''
  ].join('\n'));
  writeFile(root, '.env.example', 'FIXTURE_KEY=placeholder\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, '.node-version', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:22.19.0-bookworm-slim\n');
  writeFile(root, 'src/index.js', 'module.exports = 1;\n');
  writeFile(root, 'server.js', 'module.exports = 1;\n');
  return root;
}

function withProject(callback) {
  const root = makeProject();
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

function assertFinding(report, code) {
  const result = finding(report, code);
  assert.ok(result, `expected finding ${code}; received ${report.findings.map((item) => item.code).join(', ')}`);
  return result;
}

function setupSuccessResult(stdout = '', stderr = '') {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr,
    timedOut: false,
    outputTruncated: false,
    error: null
  };
}

test('static scanner emits runtime, lockfile, and README finding codes', () => withProject((root) => {
  writeFile(root, 'yarn.lock', '# fixture\n');
  const report = scanRepository(root);

  for (const code of [
    'MULTIPLE_LOCKFILES',
    'README_CI_COMMAND',
    'ENGINES_NODE_PRESENT',
    'NVMRC_PRESENT',
    'DOCKER_NODE_BASE_PRESENT'
  ]) {
    assertFinding(report, code);
  }
}));

test('static scanner emits empty and skipped bounded-check finding codes', () => withProject((root) => {
  writeFile(root, '.nvmrc', '\n');
  writeFile(root, '.node-version', '\n');
  const emptyReport = scanRepository(root);
  for (const code of ['NVMRC_EMPTY', 'NODE_VERSION_EMPTY']) {
    assertFinding(emptyReport, code);
  }

  const skippedReport = scanRepository(root, { maxFiles: 0 });
  for (const code of [
    'PACKAGE_JSON_UNSCANNED',
    'TEST_SCRIPT_CHECK_SKIPPED',
    'README_CHECK_SKIPPED',
    'NVMRC_CHECK_SKIPPED',
    'NODE_VERSION_CHECK_SKIPPED',
    'DOCKER_NODE_CHECK_SKIPPED'
  ]) {
    assertFinding(skippedReport, code);
  }
}));

test('invalid package metadata emits README and test-check skip findings', () => withProject((root) => {
  writeFile(root, 'package.json', '{"name":\n');
  const report = scanRepository(root);

  for (const code of [
    'TEST_SCRIPT_CHECK_SKIPPED',
    'README_CI_COMMAND',
    'README_TEST_CHECK_SKIPPED',
    'README_SCRIPT_CHECK_SKIPPED'
  ]) {
    assertFinding(report, code);
  }
}));

test('GitHub checkout-unavailable errors are covered', () => {
  const missingPath = path.join(os.tmpdir(), `cloneproof-missing-checkout-${process.pid}-${Date.now()}`);
  fs.rmSync(missingPath, { recursive: true, force: true });
  assert.throws(
    () => inspectCheckout(missingPath),
    (error) => error && error.code === 'GITHUB_CHECKOUT_UNAVAILABLE'
  );
});

test('Docker setup emits the image lifecycle finding codes', async () => {
  const alreadyPresent = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') return setupSuccessResult('[]\n');
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    }
  });
  assert.equal(alreadyPresent.code, 'DOCKER_IMAGE_ALREADY_PRESENT');

  let inspectCount = 0;
  const ready = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args) => {
      if (args[0] === 'version') return setupSuccessResult('27.0.0\n');
      if (args[0] === 'image') {
        inspectCount += 1;
        return inspectCount === 1
          ? { ...setupSuccessResult(), exitCode: 1, stderr: 'No such image' }
          : setupSuccessResult('[]\n');
      }
      if (args[0] === 'pull') return setupSuccessResult('pulled\n');
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    }
  });
  assert.equal(ready.code, 'DOCKER_IMAGE_READY');

  const pullFailed = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args) => {
      if (args[0] === 'version') return setupSuccessResult('27.0.0\n');
      if (args[0] === 'image') return { ...setupSuccessResult(), exitCode: 1, stderr: 'No such image' };
      if (args[0] === 'pull') return { ...setupSuccessResult(), exitCode: 1, stderr: 'registry unavailable' };
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    }
  });
  assert.equal(pullFailed.code, 'DOCKER_PULL_FAILED');

  const originalMkdtemp = fs.mkdtempSync;
  fs.mkdtempSync = () => {
    throw new Error('synthetic setup failure');
  };
  try {
    const setupFailed = await setupDockerImage({
      dockerCommand: '/trusted/docker',
      runner: async () => setupSuccessResult()
    });
    assert.equal(setupFailed.code, 'DOCKER_SETUP_FAILED');
  } finally {
    fs.mkdtempSync = originalMkdtemp;
  }
});

test('Docker verification emits consent and staging-source findings', async () => {
  const consentReport = await verifyRepository(healthyFixture, {
    execute: false,
    runner: async () => {
      throw new Error('runner should not be called without consent');
    }
  });
  assertFinding(consentReport, 'DOCKER_EXECUTION_CONSENT_REQUIRED');

  const targetPath = path.join(healthyFixture, 'src', 'index.js');
  const originalContents = fs.readFileSync(targetPath);
  const originalRead = fs.readFileSync;
  let targetReads = 0;
  fs.readFileSync = function patchedRead(filePath, ...args) {
    const contents = originalRead.call(fs, filePath, ...args);
    if (path.resolve(filePath) === path.resolve(targetPath)) {
      targetReads += 1;
      if (targetReads === 2) {
        fs.writeFileSync(targetPath, Buffer.concat([originalContents, Buffer.from('changed\n')]));
      }
    }
    return contents;
  };

  try {
    const changedReport = await verifyRepository(healthyFixture, {
      execute: true,
      runner: async (command, args) => {
        if (args[0] === 'version' || args[0] === 'image') return setupSuccessResult();
        throw new Error(`Docker run should not start after staging changed: ${command}`);
      }
    });
    assertFinding(changedReport, 'DOCKER_STAGING_SOURCE_CHANGED');
  } finally {
    fs.readFileSync = originalRead;
    fs.writeFileSync(targetPath, originalContents);
  }
});

test('README_CI_CHECK_SKIPPED remains represented in the scanner source inventory', () => {
  const source = fs.readFileSync(path.join(SOURCE_ROOT, 'scan', 'repository.js'), 'utf8');
  assert.match(source, /['"]README_CI_CHECK_SKIPPED['"]/);
});

function javascriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(absolute));
    else if (entry.isFile() && absolute.endsWith('.js')) files.push(absolute);
  }
  return files;
}

function emittedFindingCodes() {
  const patterns = [
    /\bcode\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\baddFinding\(\s*findings\s*,\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\bnew\s+GithubSourceError\([\s\S]{0,300}?,\s*['"]([A-Z][A-Z0-9_]*)['"]\)/g
  ];
  const codes = new Set();
  for (const file of javascriptFiles(SOURCE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

test('every source-emitted finding code has a test reference', () => {
  const testSource = javascriptFiles(path.join(__dirname))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  for (const code of emittedFindingCodes()) {
    assert.ok(testSource.includes(code), `finding code ${code} has no test reference`);
  }
});
