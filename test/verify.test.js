'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_VERIFY_IMAGE,
  dockerRunArguments,
  runProcess,
  stageRepository,
  verifyRepository
} = require('../src/verify/docker');
const { scanRepository } = require('../src/scan/repository');
const { CHECK_GROUPS, NOT_CHECKED } = require('../src/report/coverage');

const healthyFixture = path.join(__dirname, '..', 'examples', 'healthy-node');
const brokenFixture = path.join(__dirname, '..', 'examples', 'broken-node');

function makeRunner({ docker = true, image = true, run = true } = {}) {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'version') {
      return docker
        ? { exitCode: 0, signal: null, stdout: '27.0.0\n', stderr: '', timedOut: false, outputTruncated: false, error: null }
        : { exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: 'docker unavailable' };
    }
    if (args[0] === 'image') {
      return image
        ? { exitCode: 0, signal: null, stdout: '[]', stderr: '', timedOut: false, outputTruncated: false, error: null }
        : { exitCode: 1, signal: null, stdout: '', stderr: 'image missing', timedOut: false, outputTruncated: false, error: null };
    }
    return run
      ? { exitCode: 0, signal: null, stdout: 'CLONEPROOF_PHASE=install\nCLONEPROOF_PHASE=test\n', stderr: '', timedOut: false, outputTruncated: false, error: null }
      : { exitCode: 1, signal: null, stdout: 'test output', stderr: 'test failed', timedOut: false, outputTruncated: false, error: null };
  };
  return { calls, runner };
}

function makeIgnoredPathsFixture(count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-ignored-paths-'));
  fs.cpSync(healthyFixture, root, { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored-*.txt\n');
  for (let index = 0; index < count; index += 1) {
    const name = `ignored-${String(index).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(root, name), `ignored ${index}\n`);
  }
  return root;
}

function makeSensitiveFilesFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-sensitive-files-'));
  fs.cpSync(healthyFixture, root, { recursive: true });
  const files = {
    '.env': 'COMMITTED_SECRET=placeholder\n',
    'tests/.env.test': 'TEST_SECRET=placeholder\n',
    'certs/server.key': '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
    '.npmrc': 'registry=https://registry.npmjs.org/\n'
  };
  for (const [relative, contents] of Object.entries(files)) {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return { root, files };
}

function assertSummaryMatchesFindings(report) {
  assert.deepEqual(report.summary, {
    total: report.findings.length,
    passed: report.findings.filter((finding) => finding.status === 'passed').length,
    failed: report.findings.filter((finding) => finding.status === 'failed').length,
    warnings: report.findings.filter((finding) => finding.status === 'warning').length,
    skipped: report.findings.filter((finding) => finding.status === 'skipped').length
  });
}

test('Docker arguments use a controlled, non-privileged profile', () => {
  const args = dockerRunArguments('C:/temporary/source', false);

  assert.ok(args.includes('--pull=never'));
  assert.ok(args.includes('--network=none'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('--security-opt=no-new-privileges'));
  assert.ok(args.includes('--pids-limit=512'));
  assert.ok(args.includes('--memory=2g'));
  assert.ok(args.includes('--memory-swap=2g'));
  assert.ok(args.includes('--cpus=1'));
  assert.ok(args.includes('/tmp:rw,noexec,nosuid,nodev,size=512m'));
  assert.ok(args.includes('/workspace:rw,exec,nosuid,nodev,size=1g,uid=1000,gid=1000'));
  assert.ok(args.includes('--user'));
  assert.ok(args.includes('1000:1000'));
  assert.ok(args.includes(DEFAULT_VERIFY_IMAGE));
  assert.match(DEFAULT_VERIFY_IMAGE, /@sha256:[a-f0-9]{64}$/);
  assert.ok(!args.includes('--privileged'));
  assert.ok(!args.includes('--network=host'));
  assert.ok(!args.includes('/var/run/docker.sock'));
  assert.match(args.at(-1), /npm ci --ignore-scripts/);
  assert.match(args.at(-1), /npm test/);
});

test('successful Docker verification records evidence and cleans staging', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.outcome, 'passed');
  assert.equal(report.verification.networkMode, 'none');
  assert.equal(report.verification.cleanup.completed, true);
  assert.equal(report.verification.imageAvailable, true);
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_VERIFICATION_PASSED').status, 'passed');
  assert.deepEqual(report.coverage, scanRepository(healthyFixture).coverage);

  const runCall = calls.find((call) => call.args[0] === 'run');
  assert.ok(runCall);
  assert.ok(runCall.args.includes('--network=none'));
  const mount = runCall.args.find((value) => value.startsWith('type=bind,src='));
  assert.ok(mount);
  const stagedPath = mount.slice('type=bind,src='.length).split(',dst=')[0];
  assert.equal(fs.existsSync(stagedPath), false);
});

test('gitignored Docker paths are informational and have bounded sorted evidence', async () => {
  const root = makeIgnoredPathsFixture(302);
  try {
    const { runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'passed');
    assert.equal(report.verification.ignoredPathCount, 302);
    assert.equal(report.verification.ignoredPaths.length, 302);
    const finding = report.findings.find((item) => item.code === 'DOCKER_GITIGNORED_PATHS_SKIPPED');
    assert.ok(finding);
    assert.equal(finding.status, 'skipped');
    assert.equal(finding.severity, 'info');
    assert.equal(finding.evidence.length, 50);
    assert.deepEqual(
      finding.evidence.map((item) => item.path),
      report.verification.ignoredPaths.slice(0, 50)
    );
    assert.deepEqual(report.verification.ignoredPaths, [...report.verification.ignoredPaths].sort());
    assert.match(finding.message, /302/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gitignored Docker path metadata preserves the full count while capping paths', async () => {
  const root = makeIgnoredPathsFixture(600);
  try {
    const { runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.verification.ignoredPaths.length, 500);
    assert.equal(report.verification.ignoredPathCount, 600);
    assert.equal(report.verification.ignoredPathsTruncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('network access is visible and opt-in', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(healthyFixture, { execute: true, allowNetwork: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.networkMode, 'bridge');
  assert.equal(report.verification.networkConsent, true);
  const runCall = calls.find((call) => call.args[0] === 'run');
  assert.ok(runCall.args.includes('--network=bridge'));
});

test('Docker absence blocks execution without staging or running target code', async () => {
  const { calls, runner } = makeRunner({ docker: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'blocked');
  assert.equal(report.verification.outcome, 'blocked');
  assert.equal(report.verification.cleanup.completed, true);
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_UNAVAILABLE').status, 'skipped');
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0);
});

test('missing verifier image blocks execution without pulling implicitly', async () => {
  const { calls, runner } = makeRunner({ image: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'blocked');
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_IMAGE_UNAVAILABLE').status, 'skipped');
  assert.equal(report.verification.imageAvailable, false);
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0);
});

test('container failures preserve bounded diagnostics and return a failed report', async () => {
  const { calls, runner } = makeRunner({ run: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'failed');
  assert.equal(report.verification.outcome, 'failed');
  assert.equal(report.verification.exitCode, 1);
  assert.equal(report.verification.stderr, 'test failed');
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_VERIFICATION_FAILED').status, 'failed');
  assert.equal(report.verification.cleanup.completed, true);
});

test('timed-out container cleanup is explicitly attempted', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'version' || args[0] === 'image') {
      return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
    }
    if (args[0] === 'run') {
      return { exitCode: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: true, outputTruncated: false, error: null };
    }
    if (args[0] === 'rm') {
      return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
    }
    return { exitCode: 1, signal: null, stdout: '', stderr: 'not found', timedOut: false, outputTruncated: false, error: null };
  };

  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'failed');
  assert.equal(report.verification.timedOut, true);
  assert.equal(report.verification.cleanup.attempted, true);
  assert.equal(report.verification.cleanup.completed, true);
  assert.ok(calls.some((call) => call.args[0] === 'rm' && call.args[1] === '-f'));
});

test('static failures block Docker execution', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(brokenFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);

  assert.equal(report.status, 'blocked');
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_PREREQUISITES_FAILED').status, 'skipped');
  assert.equal(calls.length, 0);
});

test('unsupported verification keeps only its attempted static coverage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-unsupported-verify-'));
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# Python project\n');
    fs.writeFileSync(path.join(root, 'main.py'), 'print("hello")\n');
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });

    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.coverage, {
      checked: [CHECK_GROUPS.NESTED_PACKAGES, CHECK_GROUPS.PROJECT_CLASSIFICATION],
      notChecked: NOT_CHECKED
    });
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('placeholder npm test scripts block Docker execution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-placeholder-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'placeholder-fixture',
      scripts: { test: 'echo "Error: no test specified" && exit 1' }
    }, null, 2));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'placeholder-fixture',
      lockfileVersion: 3,
      packages: { '': { name: 'placeholder-fixture' } }
    }));
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'blocked');
    assert.equal(report.findings.find((item) => item.code === 'DOCKER_PREREQUISITES_FAILED').status, 'skipped');
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeDependencyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-dependency-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'dependency-fixture',
    dependencies: { express: '^4.19.0' },
    scripts: { test: 'node --test' }
  }, null, 2));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'dependency-fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'dependency-fixture', dependencies: { express: '^4.19.0' } },
      'node_modules/express': { version: '4.19.0' }
    }
  }));
  fs.writeFileSync(path.join(root, 'test.js'), 'test("dependency", () => {});\n');
  return root;
}

test('dependency installs without network are blocked before Docker starts', async () => {
  const root = makeDependencyFixture();
  try {
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'blocked');
    assert.equal(report.findings.find((item) => item.code === 'DOCKER_NETWORK_REQUIRED').status, 'skipped');
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dependency installs with explicit network consent reach the container', async () => {
  const root = makeDependencyFixture();
  try {
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, allowNetwork: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'passed');
    assert.equal(calls.some((call) => call.args[0] === 'run'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Docker install and test failures report the failed phase', async () => {
  const root = path.join(__dirname, '..', 'examples', 'healthy-node');
  const phases = [
    { phase: 'install', stdout: 'CLONEPROOF_PHASE=install\n', stderr: 'install failed' },
    { phase: 'test', stdout: 'CLONEPROOF_PHASE=install\nCLONEPROOF_PHASE=test\n', stderr: 'test failed' }
  ];

  for (const expected of phases) {
    const runner = async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') {
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
      return { exitCode: 1, signal: null, stdout: expected.stdout, stderr: expected.stderr, timedOut: false, outputTruncated: false, error: null };
    };
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);
    assert.equal(report.status, 'failed');
    assert.equal(report.verification.failedPhase, expected.phase);
    assert.match(report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED').title, new RegExp(expected.phase, 'i'));
  }
});

test('test-phase failures explain skipped install scripts for native packages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-install-script-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'install-script-fixture',
      scripts: { test: 'node --test' }
    }, null, 2));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'install-script-fixture',
      lockfileVersion: 3,
      packages: {
        '': { name: 'install-script-fixture' },
        'node_modules/native-addon': { version: '1.0.0', hasInstallScript: true }
      }
    }));
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'test', 'index.test.js'), 'test("fixture", () => {});\n');

    const runner = async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') {
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
      return {
        exitCode: 1,
        signal: null,
        stdout: 'CLONEPROOF_PHASE=install\nCLONEPROOF_PHASE=test\n',
        stderr: 'native binding unavailable',
        timedOut: false,
        outputTruncated: false,
        error: null
      };
    };

    const report = await verifyRepository(root, { execute: true, allowNetwork: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'failed');
    assert.equal(report.verification.failedPhase, 'test');
    const installScriptsFinding = report.findings.find((item) => item.code === 'INSTALL_SCRIPTS_SKIPPED');
    assert.equal(installScriptsFinding.status, 'skipped');
    assert.equal(installScriptsFinding.severity, 'info');
    const failure = report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED');
    assert.match(failure.message, /CloneProof intentionally skips lifecycle\/install scripts/);
    assert.match(failure.message, /packages .* likely cause/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-phase browser failures explain the controlled image browser limitation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-browser-test-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'browser-test-fixture',
      devDependencies: { '@playwright/test': '^1.50.0' },
      scripts: {
        test: 'npm run test:browser',
        'test:browser': 'playwright test'
      }
    }, null, 2));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'browser-test-fixture',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'browser-test-fixture',
          devDependencies: { '@playwright/test': '^1.50.0' }
        }
      }
    }, null, 2));
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'test', 'browser.test.js'), 'test("browser", () => {});\n');

    const runner = async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') {
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
      return {
        exitCode: 1,
        signal: null,
        stdout: 'CLONEPROOF_PHASE=install\nCLONEPROOF_PHASE=test\n',
        stderr: 'browserType.launch: Executable does not exist',
        timedOut: false,
        outputTruncated: false,
        error: null
      };
    };

    const report = await verifyRepository(root, { execute: true, allowNetwork: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'failed');
    assert.equal(report.verification.failedPhase, 'test');
    const browserFinding = report.findings.find((item) => item.code === 'BROWSER_TESTS_DETECTED');
    assert.equal(browserFinding.status, 'warning');
    const failure = report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED');
    assert.match(failure.message, /controlled image has no browser executable or browser installation/i);
    assert.match(failure.message, /may cause this test failure/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('network install errors are blocked when network is disabled', async () => {
  const root = makeDependencyFixture();
  try {
    const runner = async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') {
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
      return { exitCode: 1, signal: null, stdout: 'CLONEPROOF_PHASE=install\n', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org', timedOut: false, outputTruncated: false, error: null };
    };
    const report = await verifyRepository(root, { execute: true, runner });
    assertSummaryMatchesFindings(report);
    assert.equal(report.status, 'blocked');
    assert.equal(report.findings.find((item) => item.code === 'DOCKER_NETWORK_REQUIRED').status, 'skipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exit code 137 explains the likely memory limit', async () => {
  const runner = async (command, args) => {
    if (args[0] === 'version' || args[0] === 'image') {
      return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
    }
    return { exitCode: 137, signal: null, stdout: 'CLONEPROOF_PHASE=test\n', stderr: '', timedOut: false, outputTruncated: false, error: null };
  };
  const report = await verifyRepository(healthyFixture, { execute: true, runner });
  assertSummaryMatchesFindings(report);
  const failure = report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED');
  assert.match(failure.message, /memory/i);
});

test('staging per-file limits block verification before a container starts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-file-limit-'));
  try {
    fs.cpSync(healthyFixture, root, { recursive: true });
    fs.writeFileSync(path.join(root, 'large.bin'), Buffer.alloc(8, 1));
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, {
      execute: true,
      runner,
      stagingLimits: { maxFileBytes: 4 }
    });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'blocked');
    assert.equal(report.findings.find((item) => item.code === 'DOCKER_STAGING_LIMIT_EXCEEDED').status, 'skipped');
    assert.equal(calls.some((call) => call.args[0] === 'run'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging total limits block verification before a container starts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-total-limit-'));
  try {
    fs.cpSync(healthyFixture, root, { recursive: true });
    fs.writeFileSync(path.join(root, 'first.bin'), Buffer.alloc(4, 1));
    fs.writeFileSync(path.join(root, 'second.bin'), Buffer.alloc(4, 2));
    const { calls, runner } = makeRunner();
    const report = await verifyRepository(root, {
      execute: true,
      runner,
      stagingLimits: { maxTotalBytes: 5 }
    });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'blocked');
    assert.equal(report.findings.find((item) => item.code === 'DOCKER_STAGING_LIMIT_EXCEEDED').status, 'skipped');
    assert.equal(calls.some((call) => call.args[0] === 'run'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging excludes real environment files but keeps safe examples', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-source-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-target-'));
  try {
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=do-not-copy\n');
    fs.writeFileSync(path.join(root, '.env.example'), 'SECRET=placeholder\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n');

    const result = stageRepository(root, staging);

    assert.equal(result.skippedSensitivePaths.includes('.env'), true);
    assert.equal(fs.existsSync(path.join(result.destinationRoot, '.env')), false);
    assert.equal(fs.existsSync(path.join(result.destinationRoot, '.env.example')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
});

test('local staging omits committed sensitive files and reports the omission', async () => {
  const { root, files } = makeSensitiveFilesFixture();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-local-sensitive-target-'));
  try {
    const result = stageRepository(root, staging, { freshClone: false });
    const sensitivePaths = Object.keys(files).sort();

    assert.deepEqual(result.skippedSensitivePaths.sort(), sensitivePaths);
    for (const relative of sensitivePaths) {
      assert.equal(fs.existsSync(path.join(result.destinationRoot, relative)), false, relative);
    }

    const { runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, freshClone: false, runner });
    assert.deepEqual(report.verification.omittedPaths, sensitivePaths);
    assert.ok(report.findings.some((finding) => finding.code === 'DOCKER_SENSITIVE_FILES_OMITTED'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
});

test('fresh-clone staging copies committed sensitive files without an omission finding', async () => {
  const { root, files } = makeSensitiveFilesFixture();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-fresh-sensitive-target-'));
  try {
    const result = stageRepository(root, staging, { freshClone: true });

    assert.deepEqual(result.skippedSensitivePaths, []);
    for (const [relative, contents] of Object.entries(files)) {
      assert.equal(fs.readFileSync(path.join(result.destinationRoot, relative), 'utf8'), contents, relative);
    }

    const { runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, freshClone: true, runner });
    assert.deepEqual(report.verification.omittedPaths, []);
    assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_SENSITIVE_FILES_OMITTED'), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
});

test('local staging skips gitignored directories but still copies core files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-gitignore-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-stage-gitignore-target-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\npackage-lock.json\n');
    fs.mkdirSync(path.join(root, 'build'));
    fs.writeFileSync(path.join(root, 'build', 'generated.js'), 'throw new Error("must not stage");\n');

    const result = stageRepository(root, staging);

    assert.ok(result.skippedIgnoredPaths.includes('build'));
    assert.equal(fs.existsSync(path.join(result.destinationRoot, 'build')), false);
    assert.equal(fs.existsSync(path.join(result.destinationRoot, 'package-lock.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
});

test('Git-listed symlinks block verification with bounded evidence and no Docker run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-git-symlink-list-'));
  try {
    fs.cpSync(healthyFixture, root, { recursive: true });
    fs.mkdirSync(path.join(root, 'tests', 'fixtures'), { recursive: true });
    const symlinkPaths = Array.from({ length: 55 }, (_, index) => {
      const relative = `tests/fixtures/pmlink-${String(index).padStart(3, '0')}`;
      fs.writeFileSync(path.join(root, ...relative.split('/')), 'regular checkout text\n');
      return relative;
    });
    const { calls, runner } = makeRunner();

    const report = await verifyRepository(root, {
      execute: true,
      symlinkPaths,
      runner
    });
    assertSummaryMatchesFindings(report);

    const finding = report.findings.find((item) => item.code === 'DOCKER_SYMLINKS_BLOCKED');
    assert.equal(report.status, 'blocked');
    assert.equal(finding.status, 'skipped');
    assert.match(finding.message, /55 symlinks/);
    assert.equal(finding.evidence.length, 50);
    assert.match(report.verification.stderr, /55 total/);
    assert.equal(calls.some((call) => call.args[0] === 'run'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('host process runner enforces a timeout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 500);'], { timeoutMs: 30 });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});
