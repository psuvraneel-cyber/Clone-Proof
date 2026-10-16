'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  dockerRunArguments,
  runProcess,
  stageRepository,
  verifyRepository
} = require('../src/verify/docker');

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
  assert.ok(args.includes('/workspace:rw,nosuid,nodev,size=1g,uid=1000,gid=1000'));
  assert.ok(args.includes('--user'));
  assert.ok(args.includes('1000:1000'));
  assert.ok(!args.includes('--privileged'));
  assert.ok(!args.includes('--network=host'));
  assert.ok(!args.includes('/var/run/docker.sock'));
  assert.match(args.at(-1), /npm ci --ignore-scripts/);
  assert.match(args.at(-1), /npm test/);
});

test('successful Docker verification records evidence and cleans staging', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(healthyFixture, { execute: true, runner });

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.outcome, 'passed');
  assert.equal(report.verification.networkMode, 'none');
  assert.equal(report.verification.cleanup.completed, true);
  assert.equal(report.verification.imageAvailable, true);
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_VERIFICATION_PASSED').status, 'passed');

  const runCall = calls.find((call) => call.args[0] === 'run');
  assert.ok(runCall);
  assert.ok(runCall.args.includes('--network=none'));
  const mount = runCall.args.find((value) => value.startsWith('type=bind,src='));
  assert.ok(mount);
  const stagedPath = mount.slice('type=bind,src='.length).split(',dst=')[0];
  assert.equal(fs.existsSync(stagedPath), false);
});

test('network access is visible and opt-in', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(healthyFixture, { execute: true, allowNetwork: true, runner });

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.networkMode, 'bridge');
  assert.equal(report.verification.networkConsent, true);
  const runCall = calls.find((call) => call.args[0] === 'run');
  assert.ok(runCall.args.includes('--network=bridge'));
});

test('Docker absence blocks execution without staging or running target code', async () => {
  const { calls, runner } = makeRunner({ docker: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });

  assert.equal(report.status, 'blocked');
  assert.equal(report.verification.outcome, 'blocked');
  assert.equal(report.verification.cleanup.completed, true);
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_UNAVAILABLE').status, 'skipped');
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0);
});

test('missing verifier image blocks execution without pulling implicitly', async () => {
  const { calls, runner } = makeRunner({ image: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });

  assert.equal(report.status, 'blocked');
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_IMAGE_UNAVAILABLE').status, 'skipped');
  assert.equal(report.verification.imageAvailable, false);
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0);
});

test('container failures preserve bounded diagnostics and return a failed report', async () => {
  const { calls, runner } = makeRunner({ run: false });
  const report = await verifyRepository(healthyFixture, { execute: true, runner });

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

  assert.equal(report.status, 'failed');
  assert.equal(report.verification.timedOut, true);
  assert.equal(report.verification.cleanup.attempted, true);
  assert.equal(report.verification.cleanup.completed, true);
  assert.ok(calls.some((call) => call.args[0] === 'rm' && call.args[1] === '-f'));
});

test('static failures block Docker execution', async () => {
  const { calls, runner } = makeRunner();
  const report = await verifyRepository(brokenFixture, { execute: true, runner });

  assert.equal(report.status, 'blocked');
  assert.equal(report.findings.find((finding) => finding.code === 'DOCKER_PREREQUISITES_FAILED').status, 'skipped');
  assert.equal(calls.length, 0);
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
    assert.equal(report.status, 'failed');
    assert.equal(report.verification.failedPhase, expected.phase);
    assert.match(report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED').title, new RegExp(expected.phase, 'i'));
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

test('host process runner enforces a timeout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 500);'], { timeoutMs: 30 });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});
