'use strict';

// Test-suite detection for the test-script policy (field test Run 6): a missing
// test script fails only when tests are positively identified, and a repository
// without tests keeps the advisory NO_TESTS_FOUND. Detection reads files only;
// a dependency such as husky or sass is never evidence of a test suite.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { scanRepository } = require('../src/scan/repository');
const { emitAnnotations } = require('../src/action/annotations');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function withRepository(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-tests-'));
  try {
    const packageData = { name: 'suite-fixture', version: '1.0.0', scripts: {}, ...(files['package.json'] || {}) };
    writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
    writeFile(root, 'package-lock.json', `${JSON.stringify({
      name: packageData.name,
      version: packageData.version,
      lockfileVersion: 3,
      packages: {
        '': {
          name: packageData.name,
          version: packageData.version,
          dependencies: packageData.dependencies,
          devDependencies: packageData.devDependencies
        }
      }
    }, null, 2)}\n`);
    writeFile(root, 'index.js', 'module.exports = 1;\n');
    for (const [relativePath, contents] of Object.entries(files)) {
      if (relativePath !== 'package.json') writeFile(root, relativePath, contents);
    }
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testFinding(report) {
  return report.findings.find((finding) => ['NO_TESTS_FOUND', 'TEST_SCRIPT_MISSING'].includes(finding.code));
}

// Runs the CLI and the Action's annotation step on the same repository, so the
// finding, report status, exit code, and CI annotation level are checked together.
function runEverywhere(root) {
  const reportPath = path.join(root, '..', `${path.basename(root)}-report.json`);
  try {
    const child = spawnSync(process.execPath, [CLI, 'check', root, '--format', 'json', '--output', reportPath], { encoding: 'utf8' });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const annotations = emitAnnotations(report, { workspaceRoot: root, targetRoot: root, destination: null }).lines;
    return { exitCode: child.status, report, annotations };
  } finally {
    fs.rmSync(reportPath, { force: true });
  }
}

const NO_TEST_REPOSITORIES = {
  'husky consumer with Git hooks': {
    'package.json': { devDependencies: { husky: '^9.1.7', 'lint-staged': '^15.0.0' }, scripts: { prepare: 'husky' } },
    '.husky/pre-commit': 'npx lint-staged\n',
    '.husky/_/husky.sh': '#!/usr/bin/env sh\n'
  },
  'Dart Sass consumer': {
    'package.json': { dependencies: { sass: '^1.80.0' }, scripts: { build: 'sass src/main.scss dist/main.css' } },
    'src/main.scss': 'body { margin: 0; }\n'
  },
  'shell scripts outside test folders and test inputs': {
    'scripts/release.sh': '#!/bin/sh\n',
    'test/fixtures/setup.sh': '#!/bin/sh\n',
    'testdata/parser_test.go': 'package parser\n',
    'vendor/lib/tool_test.py': 'def test_x(): pass\n'
  },
  'npm placeholder test script and no tests': {
    'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } }
  }
};

const TEST_SUITE_REPOSITORIES = {
  'shell suite (test.sh and test/*.sh)': { 'test.sh': '#!/bin/sh\nfor t in test/*.sh; do sh "$t"; done\n', 'test/1_default.sh': '#!/bin/sh\n' },
  'Bats suite': { 'test/cli.bats': '@test "runs" { true; }\n' },
  'Dart suite': { 'pubspec.yaml': 'name: tool\n', 'test/compile_test.dart': 'void main() {}\n' },
  'Go suite': { 'go.mod': 'module example.invalid/tool\n', 'parser/parser_test.go': 'package parser\n' },
  'Python suite': { 'tests/test_tool.py': 'def test_x(): pass\n' },
  'JavaScript suite': { 'src/index.test.js': 'test("x", () => {});\n' },
  'README asks contributors to run tests': { 'README.md': '## Contributing\n\n```bash\nnpm test\n```\n' }
};

for (const [name, files] of Object.entries(NO_TEST_REPOSITORIES)) {
  test(`no tests: ${name} keeps the NO_TESTS_FOUND warning and exits 0`, () => withRepository(files, (root) => {
    const { exitCode, report, annotations } = runEverywhere(root);
    const finding = testFinding(report);

    assert.equal(finding.code, 'NO_TESTS_FOUND');
    assert.equal(finding.status, 'warning');
    assert.equal(finding.severity, 'warning');
    assert.equal(report.status, 'passed_with_warnings');
    assert.equal(exitCode, 0);
    assert.ok(annotations.some((line) => line.startsWith('::warning ') && line.includes('title=NO_TESTS_FOUND')));
    assert.ok(!annotations.some((line) => line.startsWith('::error ')));
  }));
}

for (const [name, files] of Object.entries(TEST_SUITE_REPOSITORIES)) {
  test(`tests found: ${name} fails with TEST_SCRIPT_MISSING and exits 1`, () => withRepository(files, (root) => {
    const { exitCode, report, annotations } = runEverywhere(root);
    const finding = testFinding(report);

    assert.equal(finding.code, 'TEST_SCRIPT_MISSING');
    assert.equal(finding.status, 'failed');
    assert.equal(finding.severity, 'error');
    assert.equal(report.status, 'failed');
    assert.equal(exitCode, 1);
    assert.ok(annotations.some((line) => line.startsWith('::error ') && line.includes('title=TEST_SCRIPT_MISSING')));
  }));
}

test('a working test script is never replaced by either finding, whatever the suite language', () => withRepository({
  'package.json': { scripts: { test: 'sh test.sh' } },
  'test.sh': '#!/bin/sh\n',
  'test/1_default.sh': '#!/bin/sh\n'
}, (root) => {
  const report = scanRepository(root);
  assert.equal(testFinding(report), undefined);
  assert.equal(report.findings.find((finding) => finding.code === 'TEST_SCRIPT_PRESENT').status, 'passed');
}));

test('--require-tests still fails a repository without tests', () => withRepository(NO_TEST_REPOSITORIES['husky consumer with Git hooks'], (root) => {
  const report = scanRepository(root, { requireTests: true });
  assert.equal(testFinding(report).code, 'TEST_SCRIPT_MISSING');
  assert.equal(testFinding(report).status, 'failed');
}));
