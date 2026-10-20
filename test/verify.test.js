'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_VERIFY_IMAGE,
  dockerRunArguments,
  runProcess,
  setupDockerImage,
  stageRepository,
  verifyRepository
} = require('../src/verify/docker');
const { scanRepository } = require('../src/scan/repository');
const {
  CHECK_GROUPS,
  NOT_CHECKED,
  assertCoverageConsistency
} = require('../src/report/coverage');
const { exitCodeForReport } = require('../src/report/render');

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

async function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

async function waitForCondition(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
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
  assert.doesNotThrow(() => assertCoverageConsistency(report.findings, report.coverage));
  assert.deepEqual(report.coverage, scanRepository(healthyFixture).coverage);

  const runCall = calls.find((call) => call.args[0] === 'run');
  assert.ok(runCall);
  assert.ok(runCall.args.includes('--network=none'));
  const mount = runCall.args.find((value) => value.startsWith('type=bind,src='));
  assert.ok(mount);
  const stagedPath = mount.slice('type=bind,src='.length).split(',dst=')[0];
  assert.equal(fs.existsSync(stagedPath), false);
});

test('zero-test success is reported for supported test-runner output', async () => {
  const outputs = [
    { output: 'TAP version 13\n1..0\n# tests 0\n# suites 0\n# pass 0\n# fail 0\n# duration_ms 1.2\n', match: '# tests 0' },
    { output: 'No tests found, exiting with code 0\n', match: 'No tests found' },
    { output: 'Test Files 0 passed (0)\nTests 0 passed (0)\n', match: 'Test Files 0' },
    { output: '0 passing (2ms)\n', match: '0 passing' },
    { output: '0 tests passed\n', match: '0 tests passed' },
    { output: "Couldn't find any files to test\n", match: "Couldn't find any files to test" },
    { output: 'TAP version 13\n1..0\n# { total: 0, passed: 0 }\n', match: '# { total: 0' }
  ];

  for (const item of outputs) {
    const report = await verifyRepository(healthyFixture, {
      execute: true,
      runner: async (command, args) => {
        if (args[0] === 'version' || args[0] === 'image') {
          return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
        }
        return { exitCode: 0, signal: null, stdout: item.output, stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
    });

    assertSummaryMatchesFindings(report);
    assert.equal(report.status, 'passed_with_warnings');
    assert.equal(report.verification.outcome, 'passed');
    assert.equal(report.verification.noTestsRan, true);
    const finding = report.findings.find((item) => item.code === 'VERIFY_NO_TESTS_RAN');
    assert.equal(finding.status, 'warning');
    assert.equal(finding.severity, 'warning');
    assert.ok(finding.evidence[0].detail.includes(item.match));
    assert.equal(report.findings.some((item) => item.code === 'DOCKER_VERIFICATION_PASSED'), false);
    assert.doesNotThrow(() => assertCoverageConsistency(report.findings, report.coverage));
  }
});

test('a non-zero test count remains a passed verification', async () => {
  const { runner } = makeRunner();
  const report = await verifyRepository(healthyFixture, {
    execute: true,
    runner: async (command, args, options) => {
      const result = await runner(command, args, options);
      if (args[0] === 'run') result.stdout = 'TAP version 13\n1..2\n# tests 2\n# pass 2\n# fail 0\n';
      return result;
    }
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.noTestsRan, false);
  assert.equal(report.findings.some((item) => item.code === 'VERIFY_NO_TESTS_RAN'), false);
  assert.equal(report.findings.some((item) => item.code === 'DOCKER_VERIFICATION_PASSED'), true);
});

test('Git metadata requirements are advisory during verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-git-metadata-'));
  fs.cpSync(healthyFixture, root, { recursive: true });
  const packagePath = path.join(root, 'package.json');
  const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageData.scripts.pretest = 'test -d .git';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageData, null, 2)}\n`);

  try {
    const { runner } = makeRunner();
    const report = await verifyRepository(root, { execute: true, runner });
    const finding = report.findings.find((item) => item.code === 'GIT_METADATA_REQUIRED');

    assert.equal(finding.status, 'warning');
    assert.equal(finding.severity, 'warning');
    assert.equal(report.status, 'passed_with_warnings');
    assert.match(finding.message, /removes \.git metadata/i);
    assertSummaryMatchesFindings(report);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('transient staging remover failures are retried without a cleanup notice', async () => {
  const { runner } = makeRunner();
  let stagingAttempts = 0;
  const report = await verifyRepository(healthyFixture, {
    execute: true,
    runner,
    removeTemporaryDirectory: async (directory) => {
      if (path.basename(directory).startsWith('cloneproof-verify-')) {
        stagingAttempts += 1;
        if (stagingAttempts < 3) throw new Error('brief staging lock');
      }
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.verification.cleanup.stagingRemoved, true);
  assert.equal(report.verification.cleanup.cleanupFailed, undefined);
  assert.ok(stagingAttempts >= 3);
});

test('cleanup failure fails verification without exposing an absolute directory', async () => {
  const { runner } = makeRunner();
  const retainedDirectories = new Set();
  try {
    const report = await verifyRepository(healthyFixture, {
      execute: true,
      runner,
      removeTemporaryDirectory: async (directory) => {
        retainedDirectories.add(directory);
        throw new Error('injected cleanup failure');
      }
    });

    assertSummaryMatchesFindings(report);
    assert.equal(report.status, 'failed');
    assert.equal(exitCodeForReport(report), 1);
    assert.equal(report.verification.cleanup.cleanupFailed, true);
    assert.equal(report.verification.cleanup.completed, false);
    assert.equal(report.verification.cleanup.cleanupDirectory.includes('\\'), false);
    assert.equal(report.verification.cleanup.cleanupDirectory.includes('/'), false);
    assert.equal(report.findings.some((finding) => finding.code === 'DOCKER_CLEANUP_INCOMPLETE'), true);
    assert.doesNotMatch(JSON.stringify(report), /AppData|C:\\Users|\/home\//);
  } finally {
    for (const directory of retainedDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
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
  const finding = report.findings.find((item) => item.code === 'DOCKER_IMAGE_UNAVAILABLE');
  assert.match(finding.recommendation, /Run cloneproof setup \(or docker pull /);
});

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

test('setup reports an already-present image without pulling', async () => {
  const calls = [];
  const result = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'version') return setupSuccessResult('27.0.0\n');
      if (args[0] === 'image') return setupSuccessResult('[]\n');
      throw new Error(`unexpected setup command: ${args.join(' ')}`);
    },
    hostEnvironment: { PATH: '/trusted/bin', CLONEPROOF_GITHUB_TOKEN: 'must-not-leak' }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /already present/i);
  assert.equal(calls.filter((call) => call.args[0] === 'pull').length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.env.CLONEPROOF_GITHUB_TOKEN, undefined);
  assert.equal(calls[0].options.env.DOCKER_CONFIG.startsWith(path.join(os.tmpdir(), 'cloneproof-docker-config-')), true);
});

test('setup pulls an absent image with the exact reference and confirms it', async () => {
  const calls = [];
  let inspectCount = 0;
  const result = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'version') return setupSuccessResult('27.0.0\n');
      if (args[0] === 'image') {
        inspectCount += 1;
        return inspectCount === 1
          ? { ...setupSuccessResult(), exitCode: 1, stderr: 'No such image' }
          : setupSuccessResult('[]\n');
      }
      if (args[0] === 'pull') return setupSuccessResult(`pulled ${DEFAULT_VERIFY_IMAGE}\n`);
      throw new Error(`unexpected setup command: ${args.join(' ')}`);
    },
    timeoutMs: 600000,
    maxOutputBytes: 4096
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /ready|pulled/i);
  const pull = calls.find((call) => call.args[0] === 'pull');
  assert.deepEqual(pull.args, ['pull', DEFAULT_VERIFY_IMAGE]);
  assert.equal(pull.options.timeoutMs, 600000);
  assert.equal(pull.options.maxOutputBytes, 4096);
  assert.equal(calls.filter((call) => call.args[0] === 'image').length, 2);
});

test('setup reports pull failures with exit code 2 and does not claim success', async () => {
  const calls = [];
  const result = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args) => {
      calls.push({ command, args });
      if (args[0] === 'version') return setupSuccessResult('27.0.0\n');
      if (args[0] === 'image') return { ...setupSuccessResult(), exitCode: 1, stderr: 'No such image' };
      if (args[0] === 'pull') return { ...setupSuccessResult(), exitCode: 1, stderr: 'registry unavailable' };
      throw new Error(`unexpected setup command: ${args.join(' ')}`);
    }
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /pull failed/i);
  assert.match(result.message, /registry unavailable/);
  assert.equal(calls.filter((call) => call.args[0] === 'image').length, 1);
});

test('setup reports daemon failure without inspecting or pulling', async () => {
  const calls = [];
  const result = await setupDockerImage({
    dockerCommand: '/trusted/docker',
    runner: async (command, args) => {
      calls.push({ command, args });
      return { ...setupSuccessResult(), exitCode: null, error: 'daemon unavailable' };
    }
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /daemon|Docker/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'version');
});

test('setup reports a missing trusted Docker executable without starting a runner', async () => {
  let runnerCalled = false;
  const result = await setupDockerImage({
    platform: 'linux',
    hostEnvironment: { PATH: 'relative-only' },
    executableLookup: () => null,
    runner: async () => {
      runnerCalled = true;
      return setupSuccessResult();
    }
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /trusted Docker executable/i);
  assert.equal(runnerCalled, false);
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

test('SIGINT force-removes an interrupted verification container', async () => {
  const signals = new EventEmitter();
  const calls = [];
  const success = {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    outputTruncated: false,
    error: null
  };
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'version' || args[0] === 'image') return success;
    if (args[0] === 'run') {
      signals.emit('SIGINT');
      return {
        ...success,
        exitCode: 137,
        signal: 'SIGKILL',
        stdout: 'CLONEPROOF_PHASE=test\n'
      };
    }
    if (args[0] === 'rm') return success;
    return { ...success, exitCode: 1, stderr: 'not found' };
  };

  const report = await verifyRepository(healthyFixture, {
    execute: true,
    runner,
    signalSource: signals
  });

  assertSummaryMatchesFindings(report);
  assert.equal(report.status, 'failed');
  assert.equal(report.verification.signal, 'SIGINT');
  assert.equal(report.verification.cleanup.completed, true);
  assert.equal(report.findings.some((finding) => finding.code === 'DOCKER_VERIFICATION_ERROR'), true);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.ok(calls.some((call) => call.args[0] === 'rm' && call.args[1] === '-f'));
});

test('Windows process-level SIGINT cleanup removes the verification container', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-process-sigint-'));
  const readyPath = path.join(root, 'ready');
  const cleanedPath = path.join(root, 'cleaned');
  const cleanupScript = path.join(root, 'cleanup.js');
  const childScript = path.join(root, 'verify.js');
  const dockerModule = path.join(__dirname, '..', 'src', 'verify', 'docker.js');

  fs.writeFileSync(cleanupScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(cleanedPath)}, 'removed');`
  ].join('\n'));
  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const { verifyRepository } = require(${JSON.stringify(dockerModule)});`,
    `const fixture = ${JSON.stringify(healthyFixture)};`,
    `const readyPath = ${JSON.stringify(readyPath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const runner = async (command, args) => {',
    '  if (args[0] === "version" || args[0] === "image") return success;',
    '  if (args[0] === "run") {',
    '    fs.writeFileSync(readyPath, "running");',
    '    await new Promise(() => setInterval(() => {}, 1000));',
    '  }',
    '  return success;',
    '};',
    `verifyRepository(fixture, { execute: true, runner, cleanupSupervisor: true, cleanupSupervisorCommand: process.execPath, cleanupSupervisorArgs: [${JSON.stringify(cleanupScript)}] }).catch(() => { process.exitCode = 1; });`
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitForFile(readyPath);
    assert.equal(child.kill('SIGINT'), true);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Verifier process did not exit: ${stderr}`)), 5000);
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        assert.equal(exitCode, null);
        assert.equal(signal, 'SIGINT');
        resolve();
      });
    });
    await waitForFile(cleanedPath);
    assert.equal(fs.readFileSync(cleanedPath, 'utf8'), 'removed');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('abrupt verifier termination removes the staging parent and Docker config directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-abrupt-cleanup-'));
  const readyPath = path.join(root, 'ready');
  const pathsPath = path.join(root, 'paths.json');
  const cleanupScript = path.join(root, 'cleanup.js');
  const childScript = path.join(root, 'verify.js');
  const dockerModule = path.join(__dirname, '..', 'src', 'verify', 'docker.js');
  let paths;

  fs.writeFileSync(cleanupScript, "'use strict';\nprocess.exitCode = 0;\n");
  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const { verifyRepository } = require(${JSON.stringify(dockerModule)});`,
    `const fixture = ${JSON.stringify(healthyFixture)};`,
    `const readyPath = ${JSON.stringify(readyPath)};`,
    `const pathsPath = ${JSON.stringify(pathsPath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const runner = async (command, args, options) => {',
    '  if (args[0] === "version" || args[0] === "image") return success;',
    '  if (args[0] === "run") {',
    '    const mount = args.find((value) => value.startsWith("type=bind,src="));',
    '    const stagedSource = mount.slice("type=bind,src=".length).split(",dst=")[0];',
    '    fs.writeFileSync(pathsPath, JSON.stringify({ stagingParent: path.dirname(stagedSource), dockerConfig: options.env.DOCKER_CONFIG }));',
    '    fs.writeFileSync(readyPath, "running");',
    '    await new Promise(() => setInterval(() => {}, 1000));',
    '  }',
    '  return success;',
    '};',
    `verifyRepository(fixture, { execute: true, runner, cleanupSupervisor: true, cleanupSupervisorCommand: process.execPath, cleanupSupervisorArgs: [${JSON.stringify(cleanupScript)}] }).catch(() => { process.exitCode = 1; });`
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitForFile(readyPath);
    await waitForFile(pathsPath);
    paths = JSON.parse(fs.readFileSync(pathsPath, 'utf8'));
    assert.equal(fs.existsSync(paths.stagingParent), true);
    assert.equal(fs.existsSync(paths.dockerConfig), true);

    child.kill('SIGKILL');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Verifier process did not exit: ${stderr}`)), 10000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await waitForCondition(() => !fs.existsSync(paths.stagingParent) && !fs.existsSync(paths.dockerConfig));
    assert.equal(fs.existsSync(paths.stagingParent), false);
    assert.equal(fs.existsSync(paths.dockerConfig), false);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    for (const directory of [paths && paths.stagingParent, paths && paths.dockerConfig].filter(Boolean)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('install failures with a private registry explain that credentials are probably needed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-private-registry-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'private-registry-fixture',
      scripts: { test: 'node --test' }
    }, null, 2));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'private-registry-fixture',
      lockfileVersion: 3,
      packages: { '': { name: 'private-registry-fixture' } }
    }));
    fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://user:password@packages.example.invalid/npm/\n');
    fs.writeFileSync(path.join(root, 'test.js'), 'test("fixture", () => {});\n');

    const runner = async (command, args) => {
      if (args[0] === 'version' || args[0] === 'image') {
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: null };
      }
      return {
        exitCode: 1,
        signal: null,
        stdout: 'CLONEPROOF_PHASE=install\n',
        stderr: 'npm ERR! code E401\nnpm ERR! Unable to authenticate, need credentials',
        timedOut: false,
        outputTruncated: false,
        error: null
      };
    };

    const report = await verifyRepository(root, { execute: true, allowNetwork: true, runner });
    assertSummaryMatchesFindings(report);

    assert.equal(report.status, 'failed');
    assert.equal(report.verification.failedPhase, 'install');
    const failure = report.findings.find((item) => item.code === 'DOCKER_VERIFICATION_FAILED');
    assert.match(failure.message, /registry credentials are probably needed/i);
    assert.ok(report.findings.some((item) => item.code === 'PRIVATE_REGISTRY'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
