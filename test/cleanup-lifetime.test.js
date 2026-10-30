'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { processIsAlive } = require('../src/util/cleanup-supervisor');

const REPO_ROOT = path.join(__dirname, '..');
const GITHUB_MODULE = path.join(REPO_ROOT, 'src', 'input', 'github.js');
const DOCKER_MODULE = path.join(REPO_ROOT, 'src', 'verify', 'docker.js');
const CLEANUP_MODULE = path.join(REPO_ROOT, 'src', 'util', 'cleanup-supervisor.js');
const HEALTHY_FIXTURE = path.join(REPO_ROOT, 'examples', 'healthy-node');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFile(filePath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await wait(25);
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

async function waitForCondition(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error('Timed out waiting for condition');
}

async function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Child process did not exit promptly')), timeoutMs))
  ]);
}

function successResult(stdout = '') {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    outputTruncated: false,
    error: null
  };
}

function supervisorWrapperLines(cleanupModule, infoPath, stopPath) {
  return [
    `const cleanup = require(${JSON.stringify(cleanupModule)});`,
    'const originalStart = cleanup.startCleanupSupervisor;',
    'const originalStop = cleanup.stopCleanupSupervisor;',
    `const supervisorInfoPath = ${JSON.stringify(infoPath)};`,
    `const supervisorStopPath = ${JSON.stringify(stopPath)};`,
    'cleanup.startCleanupSupervisor = (options) => {',
    '  const supervisor = originalStart(options);',
    '  fs.writeFileSync(supervisorInfoPath, JSON.stringify({',
    '    pid: supervisor && supervisor.pid,',
    '    stdioClosed: Boolean(supervisor && supervisor.stdin === null && supervisor.stdout === null && supervisor.stderr === null),',
    '    paths: options.paths || []',
    '  }));',
    '  return supervisor;',
    '};',
    'cleanup.stopCleanupSupervisor = (supervisor) => {',
    '  fs.writeFileSync(supervisorStopPath, "stopped");',
    '  return originalStop(supervisor);',
    '};'
  ];
}

async function cleanupTestRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
  await wait(50);
}

test('Git cleanup supervisor survives a hard kill during final removal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-github-final-cleanup-'));
  const childScript = path.join(root, 'clone.js');
  const pausePath = path.join(root, 'pause');
  const infoPath = path.join(root, 'supervisor.json');
  const stopPath = path.join(root, 'stopped');

  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    ...supervisorWrapperLines(CLEANUP_MODULE, infoPath, stopPath),
    `const { cloneGithubRepository } = require(${JSON.stringify(GITHUB_MODULE)});`,
    `const pausePath = ${JSON.stringify(pausePath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const fetcher = async () => ({ status: 200, async json() { return { private: false, size: 1 }; } });',
    'const runner = async (command, args) => {',
    '  if (args[0] === "--version") return success;',
    '  if (args.includes("clone")) {',
    '    const checkout = args.at(-1);',
    '    fs.mkdirSync(checkout, { recursive: true });',
    '    fs.writeFileSync(path.join(checkout, "README.md"), "fixture\\n");',
    '    return success;',
    '  }',
    '  if (args.includes("ls-files")) return success;',
    '  if (args.includes("rev-parse")) return { ...success, stdout: "0123456789abcdef0123456789abcdef01234567\\n" };',
    '  return success;',
    '};',
    'const removeTemporaryDirectory = async (directory) => {',
    '  if (path.basename(directory) === ".git") {',
    '    await fs.promises.rm(directory, { recursive: true, force: true });',
    '    return;',
    '  }',
    '  fs.writeFileSync(pausePath, directory);',
    '  await new Promise(() => { setInterval(() => {}, 1000); });',
    '};',
    '(async () => {',
    '  const result = await cloneGithubRepository("https://github.com/example/project", {',
    '    gitExecutable: process.execPath, fetcher, runner, cleanupSupervisor: true, removeTemporaryDirectory',
    '  });',
    '  fs.writeFileSync(path.join(path.dirname(pausePath), "ready"), "ready");',
    '  await result.cleanup();',
    '})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });'
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let temporaryParent;
  let supervisorPid;
  try {
    await waitForFile(pausePath);
    temporaryParent = fs.readFileSync(pausePath, 'utf8');
    await waitForFile(infoPath);
    const supervisorInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    supervisorPid = Number(supervisorInfo.pid);
    assert.ok(supervisorPid > 0);
    assert.equal(supervisorInfo.stdioClosed, true);

    const killedAt = Date.now();
    assert.equal(child.exitCode, null, stderr);
    child.kill('SIGKILL');
    await waitForChildExit(child);
    assert.ok(Date.now() - killedAt < 5000, stderr);

    await waitForCondition(() => !fs.existsSync(temporaryParent));
    await waitForCondition(() => !processIsAlive(supervisorPid));
    assert.equal(fs.existsSync(temporaryParent), false);
    assert.equal(fs.existsSync(stopPath), false);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (supervisorPid && processIsAlive(supervisorPid)) {
      try { process.kill(supervisorPid, 'SIGKILL'); } catch {}
    }
    await cleanupTestRoot(root);
  }
});

test('Git cleanup reports EBUSY without stopping the supervisor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-github-busy-cleanup-'));
  const childScript = path.join(root, 'clone.js');
  const resultPath = path.join(root, 'result.json');
  const infoPath = path.join(root, 'supervisor.json');
  const stopPath = path.join(root, 'stopped');

  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    ...supervisorWrapperLines(CLEANUP_MODULE, infoPath, stopPath),
    `const { cloneGithubRepository } = require(${JSON.stringify(GITHUB_MODULE)});`,
    `const resultPath = ${JSON.stringify(resultPath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const fetcher = async () => ({ status: 200, async json() { return { private: false, size: 1 }; } });',
    'const runner = async (command, args) => {',
    '  if (args[0] === "--version") return success;',
    '  if (args.includes("clone")) {',
    '    const checkout = args.at(-1);',
    '    fs.mkdirSync(checkout, { recursive: true });',
    '    fs.writeFileSync(path.join(checkout, "README.md"), "fixture\\n");',
    '    return success;',
    '  }',
    '  if (args.includes("ls-files")) return success;',
    '  if (args.includes("rev-parse")) return { ...success, stdout: "0123456789abcdef0123456789abcdef01234567\\n" };',
    '  return success;',
    '};',
    'const removeTemporaryDirectory = async (directory) => {',
    '  if (path.basename(directory) === ".git") {',
    '    await fs.promises.rm(directory, { recursive: true, force: true });',
    '    return;',
    '  }',
    '  const error = new Error("busy");',
    '  error.code = "EBUSY";',
    '  throw error;',
    '};',
    '(async () => {',
    '  const result = await cloneGithubRepository("https://github.com/example/project", {',
    '    gitExecutable: process.execPath, fetcher, runner, cleanupSupervisor: true, removeTemporaryDirectory',
    '  });',
    '  try { await result.cleanup(); } catch (error) {',
    '    fs.writeFileSync(resultPath, JSON.stringify({ code: error.code, cleanupDirectory: error.cleanupDirectory, stopped: fs.existsSync(supervisorStopPath) }));',
    '  }',
    '})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });'
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let supervisorPid;
  try {
    await waitForFile(resultPath, 10000);
    await waitForFile(infoPath, 10000);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const supervisorInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    supervisorPid = Number(supervisorInfo.pid);
    assert.equal(result.code, 'EBUSY');
    assert.ok(result.cleanupDirectory);
    assert.equal(result.stopped, false);
    assert.equal(supervisorInfo.stdioClosed, true);
    await waitForChildExit(child);
    await waitForCondition(() => !fs.existsSync(supervisorInfo.paths[0]));
    await waitForCondition(() => !processIsAlive(supervisorPid));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (supervisorPid && processIsAlive(supervisorPid)) {
      try { process.kill(supervisorPid, 'SIGKILL'); } catch {}
    }
    await cleanupTestRoot(root);
  }
});

test('Docker cleanup supervisor remains alive until staging removal succeeds', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-docker-final-cleanup-'));
  const childScript = path.join(root, 'verify.js');
  const pausePath = path.join(root, 'pause');
  const infoPath = path.join(root, 'supervisor.json');
  const stopPath = path.join(root, 'stopped');

  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    ...supervisorWrapperLines(CLEANUP_MODULE, infoPath, stopPath),
    `const { verifyRepository } = require(${JSON.stringify(DOCKER_MODULE)});`,
    `const fixture = ${JSON.stringify(HEALTHY_FIXTURE)};`,
    `const pausePath = ${JSON.stringify(pausePath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const runner = async (command, args) => {',
    '  if (args[0] === "version" || args[0] === "image") return success;',
    '  if (args[0] === "run") return { ...success, stdout: "CLONEPROOF_PHASE=install\\nCLONEPROOF_PHASE=test\\n" };',
    '  return success;',
    '};',
    'const removeTemporaryDirectory = async (directory) => {',
    '  fs.writeFileSync(pausePath, directory);',
    '  await new Promise(() => { setInterval(() => {}, 1000); });',
    '};',
    'verifyRepository(fixture, {',
    '  execute: true, runner, cleanupSupervisor: true,',
    '  cleanupSupervisorCommand: process.execPath, cleanupSupervisorArgs: ["-e", "process.exit(0)"],',
    '  removeTemporaryDirectory',
    '}).catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });'
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let supervisorPid;
  try {
    await waitForFile(pausePath);
    await waitForFile(infoPath);
    const supervisorInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    supervisorPid = Number(supervisorInfo.pid);
    assert.ok(supervisorPid > 0);
    assert.equal(supervisorInfo.stdioClosed, true);
    const killedAt = Date.now();
    assert.equal(child.exitCode, null);
    child.kill('SIGKILL');
    await waitForChildExit(child);
    assert.ok(Date.now() - killedAt < 5000);
    for (const cleanupPath of supervisorInfo.paths) {
      await waitForCondition(() => !fs.existsSync(cleanupPath));
      assert.equal(fs.existsSync(cleanupPath), false);
    }
    await waitForCondition(() => !processIsAlive(supervisorPid));
    assert.equal(fs.existsSync(stopPath), false);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (supervisorPid && processIsAlive(supervisorPid)) {
      try { process.kill(supervisorPid, 'SIGKILL'); } catch {}
    }
    await cleanupTestRoot(root);
  }
});

test('Docker cleanup reports removal failure without stopping its supervisor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-docker-busy-cleanup-'));
  const childScript = path.join(root, 'verify.js');
  const resultPath = path.join(root, 'result.json');
  const infoPath = path.join(root, 'supervisor.json');
  const stopPath = path.join(root, 'stopped');

  fs.writeFileSync(childScript, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    ...supervisorWrapperLines(CLEANUP_MODULE, infoPath, stopPath),
    `const { verifyRepository } = require(${JSON.stringify(DOCKER_MODULE)});`,
    `const fixture = ${JSON.stringify(HEALTHY_FIXTURE)};`,
    `const resultPath = ${JSON.stringify(resultPath)};`,
    'const success = { exitCode: 0, signal: null, stdout: "CLONEPROOF_PHASE=install\\nCLONEPROOF_PHASE=test\\n", stderr: "", timedOut: false, outputTruncated: false, error: null };',
    'const runner = async (command, args) => {',
    '  if (args[0] === "version" || args[0] === "image" || args[0] === "run") return success;',
    '  return success;',
    '};',
    'const removeTemporaryDirectory = async () => {',
    '  const error = new Error("busy");',
    '  error.code = "EBUSY";',
    '  throw error;',
    '};',
    '(async () => {',
    '  const report = await verifyRepository(fixture, {',
    '    execute: true, runner, cleanupSupervisor: true,',
    '    cleanupSupervisorCommand: process.execPath, cleanupSupervisorArgs: ["-e", "process.exit(0)"],',
    '    removeTemporaryDirectory',
    '  });',
    '  fs.writeFileSync(resultPath, JSON.stringify({',
    '    cleanupFailed: report.verification.cleanup.cleanupFailed,',
    '    stopped: fs.existsSync(supervisorStopPath)',
    '  }));',
    '})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });'
  ].join('\n'));

  const child = spawn(process.execPath, [childScript], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let supervisorPid;
  try {
    await waitForFile(resultPath);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const supervisorInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    supervisorPid = Number(supervisorInfo.pid);
    assert.equal(result.cleanupFailed, true);
    assert.equal(result.stopped, false);
    await waitForChildExit(child);
    await waitForCondition(() => !processIsAlive(supervisorPid));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (supervisorPid && processIsAlive(supervisorPid)) {
      try { process.kill(supervisorPid, 'SIGKILL'); } catch {}
    }
    await cleanupTestRoot(root);
  }
});
