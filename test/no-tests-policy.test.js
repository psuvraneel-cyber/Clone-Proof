'use strict';

// The test-script policy: a missing or placeholder test script fails only when
// the repository has tests that npm test cannot run (field test Run 5).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { scanRepository } = require('../src/scan/repository');
const { runAction, validateRequireTests } = require('../src/action');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-no-tests-'));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function withRepositoryAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-no-tests-'));
  try {
    return await callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

function writeProject(root, scripts = {}) {
  writeFile(root, 'package.json', JSON.stringify({ name: 'no-tests-fixture', scripts }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"no-tests-fixture","lockfileVersion":3,"packages":{"":{"name":"no-tests-fixture"}}}\n');
  writeFile(root, 'src/index.js', 'module.exports = 1;\n');
}

test('a repository with no tests and no test script gets a NO_TESTS_FOUND warning', () => withRepository((root) => {
  writeProject(root, { build: 'node build.js' });

  const report = scanRepository(root);
  const noTests = finding(report, 'NO_TESTS_FOUND');

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(noTests.status, 'warning');
  assert.equal(noTests.severity, 'warning');
  assert.match(noTests.message, /does not define a test script/);
  assert.match(noTests.recommendation, /--require-tests/);
  assert.equal(finding(report, 'TEST_SCRIPT_MISSING'), undefined);
  assert.deepEqual(report.coverage.checked.includes('test-script'), true);
}));

test('the npm placeholder test script without tests is also only a warning', () => withRepository((root) => {
  writeProject(root, { test: 'echo "Error: no test specified" && exit 1' });

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.match(finding(report, 'NO_TESTS_FOUND').message, /placeholder/);
  assert.equal(finding(report, 'TEST_SCRIPT_PLACEHOLDER'), undefined);
}));

test('test files that npm test cannot run still fail the check', () => {
  const testFiles = [
    ['src/index.test.ts', 'it("works", () => {});\n'],
    ['src/widget.spec.jsx', 'describe("widget", () => {});\n'],
    ['cypress/e2e/login.cy.js', 'describe("login", () => {});\n'],
    ['src/__tests__/helper.js', 'module.exports = {};\n'],
    ['test/api.js', "const assert = require('node:assert');\nassert.equal(1, 1);\n"],
    ['tests/run.mjs', "import { test } from 'node:test';\ntest('x', () => {});\n"]
  ];
  for (const [relativePath, contents] of testFiles) {
    withRepository((root) => {
      writeProject(root, { build: 'node build.js' });
      writeFile(root, relativePath, contents);

      const report = scanRepository(root);

      assert.equal(report.status, 'failed', relativePath);
      assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed', relativePath);
      assert.equal(finding(report, 'NO_TESTS_FOUND'), undefined, relativePath);
    });
  }
});

test('files under test/ that are not tests do not count as a test suite', () => withRepository((root) => {
  writeProject(root, { dev: 'vite' });
  writeFile(root, 'test/main.ts', "import { createApp } from 'vue';\ncreateApp({}).mount('#app');\n");
  writeFile(root, 'test/dial-server.js', "const server = require('../src');\nserver.start(3000);\n");

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.ok(finding(report, 'NO_TESTS_FOUND'));
}));

test('README instructions to run tests keep the missing script blocking', () => withRepository((root) => {
  writeProject(root, { build: 'node build.js' });
  writeFile(root, 'README.md', '# Fixture\n\n```bash\nnpm install\nnpm test\n```\n');

  const report = scanRepository(root);
  const missing = finding(report, 'TEST_SCRIPT_MISSING');

  assert.equal(report.status, 'failed');
  assert.ok(missing.evidence.some((item) => item.path === 'README.md'));
}));

test('requireTests makes a repository without tests fail', () => withRepository((root) => {
  writeProject(root, { build: 'node build.js' });

  const report = scanRepository(root, { requireTests: true });

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed');
  assert.equal(finding(report, 'NO_TESTS_FOUND'), undefined);
}));

test('an incomplete scan keeps the missing test script blocking', () => withRepository((root) => {
  writeProject(root, { build: 'node build.js' });
  for (let index = 0; index < 30; index += 1) writeFile(root, `lib/file-${String(index).padStart(2, '0')}.js`, 'x');

  const report = scanRepository(root, { maxEntries: 10 });

  assert.equal(report.scan.complete, false);
  assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed');
  assert.equal(finding(report, 'NO_TESTS_FOUND'), undefined);
}));

test('the CLI exits 0 for a repository without tests and 1 with --require-tests', () => withRepository((root) => {
  writeProject(root, { build: 'node build.js' });

  const lenient = spawnSync(process.execPath, [cliPath, 'check', root, '--format', 'json'], { encoding: 'utf8' });
  const strict = spawnSync(process.execPath, [cliPath, 'check', root, '--require-tests', '--format', 'json'], { encoding: 'utf8' });

  assert.equal(lenient.status, 0);
  assert.equal(JSON.parse(lenient.stdout).status, 'passed_with_warnings');
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).status, 'failed');
}));

test('setup rejects --require-tests', () => {
  const result = spawnSync(process.execPath, [cliPath, 'setup', '--require-tests'], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /setup does not accept/);
});

test('the Action require-tests input accepts only true or false', () => {
  assert.equal(validateRequireTests(undefined), false);
  assert.equal(validateRequireTests(''), false);
  assert.equal(validateRequireTests('false'), false);
  assert.equal(validateRequireTests('true'), true);
  assert.equal(validateRequireTests(true), true);
  assert.throws(() => validateRequireTests('yes'), /Invalid require-tests value: "yes"/);
});

test('the Action passes --require-tests to the CLI only when requested', async () => {
  for (const [input, expected] of [[undefined, false], ['false', false], ['true', true]]) {
    await withRepositoryAsync(async (dir) => {
      const runnerTemp = path.join(dir, 'temp');
      const targetDir = path.join(dir, 'repo');
      fs.mkdirSync(runnerTemp, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });
      const reportPath = path.join(runnerTemp, 'report.json');
      let spawnArgs = null;
      const mockSpawn = (cmd, args) => {
        spawnArgs = args;
        fs.writeFileSync(reportPath, JSON.stringify({ schemaVersion: 2, tool: 'cloneproof', status: 'passed', findings: [] }));
        return {
          stdout: { on: () => {} },
          stderr: { on: () => {} },
          on: (event, handler) => {
            if (event === 'close') setTimeout(() => handler(0, null), 5);
          }
        };
      };
      const env = {
        GITHUB_WORKSPACE: dir,
        'INPUT_TARGET-PATH': targetDir,
        'INPUT_REPORT-PATH': reportPath,
        GITHUB_OUTPUT: path.join(dir, 'output.txt'),
        RUNNER_TEMP: runnerTemp,
        ...(input === undefined ? {} : { 'INPUT_REQUIRE-TESTS': input })
      };

      await runAction({ env, spawn: mockSpawn, stderr: { write: () => true } });

      assert.equal(spawnArgs[1], 'check');
      assert.equal(spawnArgs.includes('--require-tests'), expected, `input ${input}`);
    });
  }
});
