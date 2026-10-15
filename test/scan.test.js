'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanRepository } = require('../src/scan/repository');

function makeRepository() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-scan-'));
}

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function writeHealthyRepository(root) {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'fixture-project',
    packageManager: 'npm@10.8.2',
    engines: { node: '>=22.0.0' },
    scripts: {
      build: 'node build.js',
      test: 'node --test'
    }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"fixture-project","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, 'README.md', [
    '# Fixture',
    '',
    '```bash',
    'npm ci',
    'npm test',
    'npm run build',
    'npm install',
    '```',
    ''
  ].join('\n'));
  writeFile(root, '.env.example', 'API_URL=https://example.invalid\nCLIENT_KEY=placeholder\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:22.19.0-bookworm-slim\n');
  writeFile(root, 'src/index.ts', [
    'export const api = process.env.API_URL;',
    'export const client = import.meta.env.CLIENT_KEY;'
  ].join('\n'));
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');
}

function withRepository(callback) {
  const root = makeRepository();
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

test('scans a healthy Node.js/TypeScript package', () => withRepository((root) => {
  writeHealthyRepository(root);

  const report = scanRepository(root);

  assert.equal(report.status, 'passed');
  assert.equal(report.scan.complete, true);
  assert.equal(report.project.type, 'typescript');
  assert.equal(report.project.packageManager, 'npm');
  assert.equal(report.project.packageManagerVersion, '10.8.2');
  assert.equal(report.project.runtime.nvmrc, '22.19.0');
  assert.deepEqual(report.project.runtime.dockerNode, ['22.19.0']);
  assert.equal(report.project.scripts.test, 'node --test');
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
  assert.equal(report.summary.skipped, 0);
}));

test('reports a missing package test script as a blocking finding', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  delete packageData.scripts.test;
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed');
}));

test('reports an unknown npm script referenced by README', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'README.md', 'Run `npm run release` after installing dependencies.\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  const unknown = finding(report, 'README_SCRIPT_UNKNOWN');
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.message, /release/);
  assert.equal(unknown.evidence[0].path, 'README.md');
}));

test('warns when a referenced environment key is absent from the example', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, '.env.example', 'API_URL=https://example.invalid\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  const missing = finding(report, 'ENV_KEY_MISSING');
  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /CLIENT_KEY/);
  assert.equal(missing.evidence[0].path, 'src/index.ts');
}));

test('handles malformed package.json without executing or throwing', () => withRepository((root) => {
  writeFile(root, 'package.json', '{"name":');
  writeFile(root, 'src/index.js', 'module.exports = process.env.VALUE;\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(report.scan.complete, true);
  assert.equal(finding(report, 'PACKAGE_JSON_INVALID').status, 'failed');
}));

test('warns when a Node package has no lockfile', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'no-lock',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(finding(report, 'LOCKFILE_MISSING').status, 'warning');
}));

test('fails when packageManager disagrees with the root lockfile', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'mismatch',
    packageManager: 'pnpm@9.0.0',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"mismatch","lockfileVersion":3,"packages":{}}\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'PACKAGE_MANAGER_LOCKFILE_MISMATCH').status, 'failed');
}));

test('warns when exact Node runtime declarations disagree', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'runtime-mismatch',
    engines: { node: '20.0.0' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"runtime-mismatch","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:20.0.0-bookworm-slim\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(finding(report, 'RUNTIME_VERSION_MISMATCH').status, 'warning');
}));

test('skips symlinks without following them', (t) => withRepository((root) => {
  writeHealthyRepository(root);
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`);
  fs.writeFileSync(outside, 'process.env.SHOULD_NOT_BE_READ = "secret";\n');

  try {
    fs.symlinkSync(outside, path.join(root, 'linked.js'), 'file');
  } catch (error) {
    fs.rmSync(outside, { force: true });
    t.skip(`symlinks are unavailable: ${error.code || error.message}`);
    return;
  }

  try {
    const report = scanRepository(root);
    assert.equal(report.scan.complete, true);
    assert.ok(report.scan.skippedPaths.includes('linked.js'));
    assert.ok(!report.findings.some((item) => item.evidence.some((evidence) => evidence.path === 'linked.js')));
  } finally {
    fs.rmSync(outside, { force: true });
  }
}));

test('returns the same report for repeated scans', () => withRepository((root) => {
  writeHealthyRepository(root);

  const first = scanRepository(root);
  const second = scanRepository(root);

  assert.deepEqual(second, first);
  assert.match(first.scan.digest, /^[a-f0-9]{64}$/);
}));

test('marks a bounded scan incomplete and records skipped files', () => withRepository((root) => {
  writeHealthyRepository(root);

  const report = scanRepository(root, { maxFileBytes: 1 });

  assert.equal(report.status, 'incomplete');
  assert.equal(report.scan.complete, false);
  assert.ok(report.scan.skippedPaths.includes('package.json'));
  assert.deepEqual(report.scan.limits, {
    maxDepth: 25,
    maxFiles: 10000,
    maxFileBytes: 1,
    maxTotalBytes: 10 * 1024 * 1024
  });
}));
