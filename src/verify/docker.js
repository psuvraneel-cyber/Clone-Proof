'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { isCoreFile, loadGitignoreMatcher, scanRepository } = require('../scan/repository');
const { resolveDockerExecutable } = require('../util/executable');

const DEFAULT_VERIFY_IMAGE = 'node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90';
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_CONTAINER_MEMORY = '2g';
const DEFAULT_CONTAINER_MEMORY_SWAP = '2g';
const DEFAULT_CONTAINER_PIDS = '512';
const DEFAULT_TMPFS_SIZE = '512m';
const DEFAULT_WORKSPACE_TMPFS_SIZE = '1g';
const DOCKER_PROBE_TIMEOUT_MS = 5000;
const MAX_IGNORED_PATHS = 500;
const MAX_IGNORED_PATH_EVIDENCE = 50;
const STAGING_LIMITS = Object.freeze({
  maxDepth: 25,
  maxFiles: 20000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024
});
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml'
]);

function dockerClientEnvironment(configDirectory, hostEnvironment = process.env) {
  const environment = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    const value = hostEnvironment[name] ?? hostEnvironment[name.toLowerCase()];
    if (value) environment[name] = value;
  }
  environment.DOCKER_CONFIG = configDirectory;
  return environment;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizePositiveInteger(value, fallback, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function appendOutput(state, chunk, child) {
  const text = String(chunk);
  const bytes = Buffer.byteLength(text, 'utf8');
  const remaining = state.maxBytes - state.bytes;
  if (remaining <= 0) {
    state.truncated = true;
    if (!state.killedForOutput) {
      state.killedForOutput = true;
      child.kill('SIGKILL');
    }
    return;
  }

  if (bytes <= remaining) {
    state.parts.push(text);
    state.bytes += bytes;
    return;
  }

  state.parts.push(Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8'));
  state.bytes = state.maxBytes;
  state.truncated = true;
  if (!state.killedForOutput) {
    state.killedForOutput = true;
    child.kill('SIGKILL');
  }
}

/**
 * Run a host process without a shell and with bounded output/time.
 * This is used only for the Docker CLI itself, never for target commands.
 */
function runProcess(command, args, options = {}) {
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10 * 60 * 1000);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 10 * 1024 * 1024);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        outputTruncated: false,
        error: error.message
      });
      return;
    }

    const stdout = { parts: [], bytes: 0, maxBytes: maxOutputBytes, truncated: false, killedForOutput: false };
    const stderr = { parts: [], bytes: 0, maxBytes: maxOutputBytes, truncated: false, killedForOutput: false };
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => appendOutput(stdout, chunk, child));
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => appendOutput(stderr, chunk, child));
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: stdout.parts.join(''),
        stderr: stderr.parts.join(''),
        timedOut,
        outputTruncated: stdout.truncated || stderr.truncated,
        error: result.error || null
      });
    }

    child.once('error', (error) => finish({ exitCode: null, signal: null, error: error.message }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal }));
  });
}

function relativePath(rootPath, absolutePath) {
  return (path.relative(rootPath, absolutePath) || '.').split(path.sep).join('/');
}

function isSensitiveFile(relativeFile) {
  const baseName = path.posix.basename(relativeFile);
  const normalizedName = baseName.toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(normalizedName)) return true;
  if (normalizedName.startsWith('.env.') && normalizedName !== '.env.example' && normalizedName !== '.env.sample') return true;
  if (normalizedName === '.envrc' || normalizedName === 'credentials.json' || normalizedName === 'application_default_credentials.json') return true;
  if (/(?:\.pem|\.key|\.p12|\.pfx|\.crt)$/i.test(normalizedName)) return true;
  return false;
}

function stageRepository(rootPath, stagingRoot, overrides = {}) {
  const sourceRoot = path.resolve(rootPath);
  const destinationRoot = path.join(stagingRoot, 'source');
  const symlinkPaths = [];
  const skippedSensitivePaths = [];
  const skippedIgnoredPaths = [];
  let fileCount = 0;
  let totalBytes = 0;

  fs.mkdirSync(destinationRoot, { recursive: true });

  const limits = { ...STAGING_LIMITS, ...overrides };
  const maxDepth = limits.maxDepth;
  const maxFiles = limits.maxFiles;
  const executablePaths = new Set((overrides.executablePaths || []).map((relative) => String(relative).split('\\').join('/')));
  const gitSymlinkPaths = new Set(
    (Array.isArray(overrides.symlinkPaths) ? overrides.symlinkPaths : [])
      .map((relative) => String(relative).split('\\').join('/'))
      .filter((relative) => relative.length > 0)
  );
  symlinkPaths.push(...gitSymlinkPaths);
  const ignoreMatcher = loadGitignoreMatcher(sourceRoot, overrides.freshClone === true, gitSymlinkPaths);

  function walk(sourceDirectory, destinationDirectory, depth) {
    const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
    const orderedEntries = [
      ...entries.filter((entry) => !entry.isDirectory()).sort((left, right) => compareStrings(left.name, right.name)),
      ...entries.filter((entry) => entry.isDirectory()).sort((left, right) => compareStrings(left.name, right.name))
    ];

    for (const entry of orderedEntries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const relative = relativePath(sourceRoot, sourcePath);
      const destinationPath = path.join(destinationRoot, relative.split('/').join(path.sep));

      if (gitSymlinkPaths.has(relative)) {
        continue;
      }

      const stat = fs.lstatSync(sourcePath);

      if (stat.isSymbolicLink()) {
        symlinkPaths.push(relative);
        continue;
      }
      if (stat.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
        if (ignoreMatcher && ignoreMatcher.isIgnored(relative, true)) {
          skippedIgnoredPaths.push(relative);
          continue;
        }
        if (depth + 1 > maxDepth) {
          const error = new Error(`staging depth limit exceeded at ${relative}`);
          error.code = 'STAGING_LIMIT_EXCEEDED';
          throw error;
        }
        fs.mkdirSync(destinationPath, { recursive: true, mode: 0o755 });
        walk(sourcePath, destinationPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      const coreFile = isCoreFile(relative);
      const ignored = ignoreMatcher && ignoreMatcher.isIgnored(relative, false);
      if (ignored && !coreFile) skippedIgnoredPaths.push(relative);
      if (overrides.freshClone !== true && isSensitiveFile(relative)) {
        skippedSensitivePaths.push(relative);
        continue;
      }
      if (ignored && !coreFile) continue;

      if (fileCount >= maxFiles) {
        const error = new Error(`staging file-count limit exceeded at ${relative}`);
        error.code = 'STAGING_LIMIT_EXCEEDED';
        throw error;
      }
      const maxFileBytes = limits.maxFileBytes;
      const maxTotalBytes = limits.maxTotalBytes;
      if (stat.size > maxFileBytes || totalBytes + stat.size > maxTotalBytes) {
        const error = new Error(`staging limits exceeded at ${relative}`);
        error.code = 'STAGING_LIMIT_EXCEEDED';
        throw error;
      }

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o755 });
      const contents = fs.readFileSync(sourcePath);
      const afterRead = fs.lstatSync(sourcePath);
      if (!afterRead.isFile() || afterRead.size !== stat.size) {
        const error = new Error(`repository file changed while staging: ${relative}`);
        error.code = 'STAGING_SOURCE_CHANGED';
        throw error;
      }
      const executable = executablePaths.has(relative) || Boolean(stat.mode & 0o111);
      fs.writeFileSync(destinationPath, contents, { mode: executable ? 0o755 : 0o644 });
      fileCount += 1;
      totalBytes += contents.length;
    }
  }

  walk(sourceRoot, destinationRoot, 0);
  return {
    destinationRoot,
    symlinkPaths: [...new Set(symlinkPaths)].sort(compareStrings),
    skippedSensitivePaths,
    skippedIgnoredPaths,
    fileCount,
    totalBytes
  };
}

function dockerRunArguments(stagingRoot, allowNetwork, containerName = 'cloneproof-verify') {
  if (/[\r\n,]/.test(stagingRoot)) {
    throw new Error('staging path contains characters that are unsafe in a Docker mount specification');
  }
  const network = allowNetwork ? 'bridge' : 'none';
  const controlledScript = [
    'set -eu',
    'mkdir -p /tmp/npm-cache /tmp/home',
    'cp -R /source/. /workspace/',
    'export HOME=/tmp/home NPM_CONFIG_CACHE=/tmp/npm-cache',
    'printf "CLONEPROOF_PHASE=install\\n"',
    'npm ci --ignore-scripts',
    'printf "CLONEPROOF_PHASE=test\\n"',
    'npm test'
  ].join('; ');

  return [
    'run',
    '--rm',
    '--init',
    '--pull=never',
    '--name',
    containerName,
    `--network=${network}`,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${DEFAULT_CONTAINER_PIDS}`,
    `--memory=${DEFAULT_CONTAINER_MEMORY}`,
    `--memory-swap=${DEFAULT_CONTAINER_MEMORY_SWAP}`,
    '--cpus=1',
    '--ulimit',
    'nofile=1024:1024',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=${DEFAULT_TMPFS_SIZE}`,
    '--tmpfs',
    `/workspace:rw,exec,nosuid,nodev,size=${DEFAULT_WORKSPACE_TMPFS_SIZE},uid=1000,gid=1000`,
    '--mount',
    `type=bind,src=${stagingRoot},dst=/source,readonly`,
    '--workdir',
    '/workspace',
    '--user',
    '1000:1000',
    '--entrypoint',
    '/bin/sh',
    DEFAULT_VERIFY_IMAGE,
    '-c',
    controlledScript
  ];
}

function makeEvidence(pathValue, detail) {
  return [{ path: pathValue, detail }];
}

function redactOutput(value) {
  if (!value) return '';
  return String(value)
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/((?:npm[_-]?token|auth[_-]?token|api[_-]?key|secret|password)\s*[=:]\s*)[^\s&]+/gi, '$1[REDACTED]');
}

function addFinding(report, finding) {
  report.findings.push(finding);
}

function recomputeSummary(report) {
  report.summary = {
    total: report.findings.length,
    passed: report.findings.filter((finding) => finding.status === 'passed').length,
    failed: report.findings.filter((finding) => finding.status === 'failed').length,
    warnings: report.findings.filter((finding) => finding.status === 'warning').length,
    skipped: report.findings.filter((finding) => finding.status === 'skipped').length
  };
}

function finalizeVerificationReport(report) {
  recomputeSummary(report);
  const cleanup = report.verification && report.verification.cleanup;
  if (cleanup && typeof cleanup === 'object') {
    cleanup.attempted = Boolean(cleanup.attempted);
    cleanup.completed = Boolean(cleanup.completed);
    cleanup.stagingRemoved = Boolean(cleanup.stagingRemoved);
    cleanup.clientConfigRemoved = Boolean(cleanup.clientConfigRemoved);
  }
  return report;
}

function cloneReport(report) {
  return JSON.parse(JSON.stringify(report));
}

function staticPrerequisiteFailure(report) {
  if (report.status === 'failed' || report.status === 'incomplete') {
    return 'Static inspection found blocking or incomplete checks.';
  }
  if (report.project.type !== 'node' && report.project.type !== 'typescript') {
    return 'Only Node.js and TypeScript repositories are supported by the Docker profile.';
  }
  if (report.project.packageManager !== 'npm') {
    return 'The first Docker profile supports npm repositories only.';
  }
  if (!report.findings.some((finding) => finding.code === 'LOCKFILE_PRESENT' && finding.status === 'passed')) {
    return 'npm ci requires a recognized root lockfile.';
  }
  if (!report.findings.some((finding) => finding.code === 'TEST_SCRIPT_PRESENT' && finding.status === 'passed')) {
    return 'The Docker profile requires a non-empty package test script.';
  }
  return null;
}

function verificationFinding(outcome, verification, staticReport) {
  if (outcome === 'passed') {
    return {
      code: 'DOCKER_VERIFICATION_PASSED',
      status: 'passed',
      severity: 'info',
      title: 'Docker setup and test workflow succeeded',
      message: 'npm ci completed with lifecycle scripts disabled and npm test exited successfully inside the controlled container.',
      evidence: makeEvidence('verification', `Container exit code: ${verification.exitCode}.`),
      recommendation: 'Keep the documented setup and test workflow reproducible.'
    };
  }

  const phase = verification.failedPhase || 'setup';
  const phaseTitle = phase === 'install' ? 'Dependency installation failed' : phase === 'test' ? 'The test script failed' : 'Docker setup failed';
  let message = verification.timedOut
    ? `The controlled verification exceeded the ${verification.timeoutMs} ms time limit.`
    : `${phaseTitle}. The controlled verification exited with code ${verification.exitCode === null ? 'unknown' : verification.exitCode}.`;
  if (verification.exitCode === 137 && !verification.timedOut) {
    message += ' The container was killed, probably by the memory limit.';
  }
  if (
    outcome === 'failed'
    && phase === 'test'
    && staticReport
    && Array.isArray(staticReport.findings)
    && staticReport.findings.some((finding) => finding.code === 'INSTALL_SCRIPTS_SKIPPED')
  ) {
    message += ' CloneProof intentionally skips lifecycle/install scripts, so the affected packages are a likely cause of this test failure.';
  }
  if (
    outcome === 'failed'
    && phase === 'test'
    && staticReport
    && Array.isArray(staticReport.findings)
    && staticReport.findings.some((finding) => finding.code === 'BROWSER_TESTS_DETECTED')
  ) {
    message += ' The controlled image has no browser executable or browser installation, which may cause this test failure.';
  }
  if (
    outcome === 'failed'
    && phase === 'install'
    && staticReport
    && Array.isArray(staticReport.findings)
    && staticReport.findings.some((finding) => finding.code === 'PRIVATE_REGISTRY')
  ) {
    message += ' Private registry credentials are probably needed for dependency installation.';
  }
  return {
    code: 'DOCKER_VERIFICATION_FAILED',
    status: 'failed',
    severity: 'error',
    title: verification.timedOut ? 'Docker verification timed out' : phaseTitle,
    message,
    evidence: [
      ...makeEvidence('verification.stdout', verification.stdout ? 'Captured standard output is available in the JSON report.' : 'No standard output was captured.'),
      ...makeEvidence('verification.stderr', verification.stderr ? 'Captured standard error is available in the JSON report.' : 'No standard error was captured.')
    ],
    recommendation: verification.networkMode === 'none'
      ? 'Review the captured output. If dependency installation needs registry access, rerun only after explicitly consenting with --allow-network.'
      : 'Review the captured output, correct the repository workflow, and rerun verification.'
  };
}

function failedPhaseForResult(result) {
  if (result.timedOut || (result.exitCode === 0 && !result.error)) return null;
  const output = `${result.stdout || ''}`;
  if (/CLONEPROOF_PHASE=test/.test(output)) return 'test';
  if (/CLONEPROOF_PHASE=install/.test(output)) return 'install';
  return 'setup';
}

async function probeDocker(runner, dockerCommand, context = {}) {
  const result = await runner(
    dockerCommand,
    ['version', '--format', '{{.Server.Version}}'],
    { ...context, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
  );

  return {
    available: result.exitCode === 0 && !result.error && !result.timedOut,
    result
  };
}

function makeContainerName() {
  return `cloneproof-verify-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resultSucceeded(result) {
  return Boolean(
    result
    && result.exitCode === 0
    && !result.error
    && !result.timedOut
    && !result.outputTruncated
  );
}

function processFailureDetail(result, fallback) {
  const value = result && (result.error || result.stderr || result.stdout);
  if (!value) return fallback;
  return String(value)
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f]+/g, ' ')
    .trim()
    .slice(0, 4000) || fallback;
}

/**
 * Make the pinned verifier image available without ever changing the image
 * used by verifyRepository. The caller can inject a runner and executable for
 * offline tests; real calls still resolve Docker from trusted absolute paths.
 */
async function setupDockerImage(options = {}) {
  const runner = options.runner || runProcess;
  if (typeof runner !== 'function') {
    throw new TypeError('Docker setup runner must be a function');
  }

  const hostEnvironment = options.hostEnvironment || process.env;
  const dockerCommand = options.dockerCommand === undefined
    ? resolveDockerExecutable({
      platform: options.platform || process.platform,
      env: hostEnvironment,
      lookup: options.executableLookup
    })
    : options.dockerCommand;

  if (!dockerCommand) {
    return {
      ok: false,
      exitCode: 2,
      code: 'DOCKER_UNAVAILABLE',
      message: 'CloneProof: a trusted Docker executable was not found.'
    };
  }

  const maxOutputBytes = normalizePositiveInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
    10 * 1024 * 1024
  );
  const pullTimeoutMs = normalizePositiveInteger(
    options.timeoutMs,
    DEFAULT_SETUP_TIMEOUT_MS,
    DEFAULT_SETUP_TIMEOUT_MS
  );
  let dockerConfigRoot;

  const invoke = async (args, commandOptions) => {
    try {
      const result = await runner(dockerCommand, args, commandOptions);
      return result && typeof result === 'object'
        ? result
        : { exitCode: null, error: 'Docker runner returned no result.' };
    } catch (error) {
      return {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        outputTruncated: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  };

  try {
    dockerConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-docker-config-'));
    const dockerContext = {
      cwd: os.tmpdir(),
      env: dockerClientEnvironment(dockerConfigRoot, hostEnvironment)
    };
    const probe = await invoke(
      ['version', '--format', '{{.Server.Version}}'],
      { ...dockerContext, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
    );
    if (!resultSucceeded(probe)) {
      return {
        ok: false,
        exitCode: 2,
        code: 'DOCKER_UNAVAILABLE',
        message: `CloneProof: Docker daemon is unavailable: ${processFailureDetail(probe, 'the daemon did not respond successfully.')}`
      };
    }

    const initialInspect = await invoke(
      ['image', 'inspect', DEFAULT_VERIFY_IMAGE],
      { ...dockerContext, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
    );
    if (resultSucceeded(initialInspect)) {
      return {
        ok: true,
        exitCode: 0,
        code: 'DOCKER_IMAGE_ALREADY_PRESENT',
        message: `CloneProof: verifier image ${DEFAULT_VERIFY_IMAGE} is already present.`
      };
    }

    const pull = await invoke(
      ['pull', DEFAULT_VERIFY_IMAGE],
      { ...dockerContext, timeoutMs: pullTimeoutMs, maxOutputBytes }
    );
    if (!resultSucceeded(pull)) {
      return {
        ok: false,
        exitCode: 2,
        code: 'DOCKER_PULL_FAILED',
        message: `CloneProof: Docker image pull failed for ${DEFAULT_VERIFY_IMAGE}: ${processFailureDetail(pull, 'the pull did not complete successfully.')}`
      };
    }

    const confirmedInspect = await invoke(
      ['image', 'inspect', DEFAULT_VERIFY_IMAGE],
      { ...dockerContext, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
    );
    if (!resultSucceeded(confirmedInspect)) {
      return {
        ok: false,
        exitCode: 2,
        code: 'DOCKER_IMAGE_UNAVAILABLE',
        message: `CloneProof: Docker pull completed but the pinned image could not be confirmed: ${processFailureDetail(confirmedInspect, 'image inspect failed.')}`
      };
    }

    return {
      ok: true,
      exitCode: 0,
      code: 'DOCKER_IMAGE_READY',
      message: `CloneProof: verifier image ${DEFAULT_VERIFY_IMAGE} is ready.`
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 2,
      code: 'DOCKER_SETUP_FAILED',
      message: `CloneProof: Docker setup failed: ${processFailureDetail({ error: error && error.message }, 'unexpected setup error.')}`
    };
  } finally {
    if (dockerConfigRoot) fs.rmSync(dockerConfigRoot, { recursive: true, force: true });
  }
}

const setupDocker = setupDockerImage;

async function cleanupContainer(runner, dockerCommand, containerName, runResult, context) {
  const needsCleanup = Boolean(runResult.timedOut || runResult.outputTruncated || runResult.signal || runResult.error);
  if (!needsCleanup) {
    return { attempted: false, completed: true, detail: 'Container exited normally with --rm.' };
  }

  const remove = await runner(dockerCommand, ['rm', '-f', containerName], context);
  if (remove.exitCode === 0 && !remove.error && !remove.timedOut) {
    return { attempted: true, completed: true, detail: 'Timed-out container was force-removed.' };
  }

  const inspect = await runner(dockerCommand, ['inspect', containerName], context);
  return {
    attempted: true,
    completed: inspect.exitCode !== 0 || Boolean(inspect.error),
    detail: inspect.exitCode !== 0 || inspect.error
      ? 'Container was absent after cleanup.'
      : 'Container still exists after cleanup.'
  };
}

/**
 * Verify the supported npm workflow in a CloneProof-controlled container.
 * The caller must pass execute:true. Network access is disabled unless
 * allowNetwork:true is explicitly supplied.
 */
async function verifyRepository(rootPath, options = {}) {
  const runner = options.runner || runProcess;
  const dockerCommand = options.runner
    ? (options.dockerCommand || 'docker')
    : resolveDockerExecutable();
  const execute = options.execute === true;
  const allowNetwork = options.allowNetwork === true;
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10 * 60 * 1000);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 10 * 1024 * 1024);
  const staticReport = scanRepository(rootPath, {
    freshClone: options.freshClone === true,
    symlinkPaths: options.symlinkPaths || []
  });
  const report = cloneReport(staticReport);
  report.mode = 'verify';
  report.verification = {
    requested: true,
    authorized: execute,
    image: DEFAULT_VERIFY_IMAGE,
    networkMode: allowNetwork ? 'bridge' : 'none',
    networkConsent: allowNetwork,
    timeoutMs,
    maxOutputBytes,
    commands: [
      'copy the scanned repository snapshot into the container',
      'npm ci --ignore-scripts',
      'npm test'
    ],
    outcome: 'blocked',
    dockerAvailable: false,
    imageAvailable: false,
    dockerExecutable: dockerCommand ? path.basename(dockerCommand) : null,
    exitCode: null,
    signal: null,
    failedPhase: null,
    timedOut: false,
    outputTruncated: false,
    stdout: '',
    stderr: '',
    omittedPaths: [],
    ignoredPaths: [],
    ignoredPathCount: 0,
    ignoredPathsTruncated: false,
    cleanup: { attempted: false, completed: true, stagingRemoved: false, clientConfigRemoved: false }
  };

  if (!execute) {
    report.verification.stderr = 'Execution requires explicit --execute authorization.';
    addFinding(report, {
      code: 'DOCKER_EXECUTION_CONSENT_REQUIRED',
      status: 'skipped',
      severity: 'warning',
      title: 'Docker verification was not authorized',
      message: 'CloneProof will not execute repository code without the explicit --execute flag.',
      evidence: [],
      recommendation: 'Review the repository and run verify with --docker --execute when you are ready.'
    });
    report.status = 'blocked';
    return finalizeVerificationReport(report);
  }

  const prerequisiteFailure = staticPrerequisiteFailure(report);
  if (prerequisiteFailure) {
    report.verification.stderr = prerequisiteFailure;
    addFinding(report, {
      code: 'DOCKER_PREREQUISITES_FAILED',
      status: 'skipped',
      severity: 'warning',
      title: 'Docker verification was blocked by static checks',
      message: prerequisiteFailure,
      evidence: makeEvidence('verification', 'The supported Docker profile was not started.'),
      recommendation: 'Fix the blocking static findings or use the supported npm/Node project shape, then rerun verification.'
    });
    report.status = 'blocked';
    return finalizeVerificationReport(report);
  }

  const externalPackageCount = report.project.lockfile && report.project.lockfile.externalPackageCount;
  if (!allowNetwork && externalPackageCount > 0) {
    const message = `npm ci must download ${externalPackageCount} packages, but network access is disabled.`;
    report.verification.outcome = 'blocked';
    report.verification.stderr = message;
    addFinding(report, {
      code: 'DOCKER_NETWORK_REQUIRED',
      status: 'skipped',
      severity: 'warning',
      title: 'Docker verification requires network access',
      message,
      evidence: makeEvidence('verification', 'The parsed npm lockfile contains external packages.'),
      recommendation: 'Review the repository, then rerun with --allow-network if you trust it.'
    });
    report.status = 'blocked';
    return finalizeVerificationReport(report);
  }

  if (!dockerCommand) {
    report.verification.stderr = 'A trusted Docker executable was not found.';
    addFinding(report, {
      code: 'DOCKER_UNAVAILABLE',
      status: 'skipped',
      severity: 'warning',
      title: 'A trusted Docker executable was not found',
      message: 'CloneProof did not find Docker in a known installation path or an absolute PATH entry.',
      evidence: makeEvidence('verification', 'Docker executable resolution failed before any host process was started.'),
      recommendation: 'Install Docker, ensure its executable is on a trusted absolute PATH entry, and rerun verification.'
    });
    report.status = 'blocked';
    return finalizeVerificationReport(report);
  }

  const dockerConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-docker-config-'));
  const dockerContext = {
    cwd: os.tmpdir(),
    env: dockerClientEnvironment(dockerConfigRoot)
  };
  const docker = await probeDocker(runner, dockerCommand, dockerContext);
  report.verification.dockerAvailable = docker.available;
  if (!docker.available) {
    const detail = docker.result.error || docker.result.stderr || 'The Docker daemon did not respond successfully.';
    report.verification.stderr = detail;
    addFinding(report, {
      code: 'DOCKER_UNAVAILABLE',
      status: 'skipped',
      severity: 'warning',
      title: 'Docker is unavailable',
      message: 'CloneProof could not connect to a usable Docker daemon, so no repository code was executed.',
      evidence: makeEvidence('verification', detail),
      recommendation: 'Install and start Docker, then rerun the explicitly authorized verify command.'
    });
    report.status = 'blocked';
    report.verification.cleanup.completed = true;
    report.verification.cleanup.clientConfigRemoved = true;
    fs.rmSync(dockerConfigRoot, { recursive: true, force: true });
    return finalizeVerificationReport(report);
  }

  const imageProbe = await runner(
    dockerCommand,
    ['image', 'inspect', DEFAULT_VERIFY_IMAGE],
    { ...dockerContext, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
  );
  report.verification.imageAvailable = imageProbe.exitCode === 0 && !imageProbe.error && !imageProbe.timedOut;
  if (!report.verification.imageAvailable) {
    const detail = imageProbe.error || imageProbe.stderr || `Image ${DEFAULT_VERIFY_IMAGE} is not available locally.`;
    report.verification.stderr = detail;
    addFinding(report, {
      code: 'DOCKER_IMAGE_UNAVAILABLE',
      status: 'skipped',
      severity: 'warning',
      title: 'The controlled Docker image is unavailable locally',
      message: `CloneProof will not pull ${DEFAULT_VERIFY_IMAGE} implicitly.`,
      evidence: makeEvidence('verification', detail),
      recommendation: `Run cloneproof setup (or docker pull ${DEFAULT_VERIFY_IMAGE})`
    });
    report.status = 'blocked';
    report.verification.cleanup.completed = true;
    report.verification.cleanup.clientConfigRemoved = true;
    fs.rmSync(dockerConfigRoot, { recursive: true, force: true });
    return finalizeVerificationReport(report);
  }

  let temporaryRoot = null;
  const containerName = makeContainerName();
  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-verify-'));
    const staged = stageRepository(rootPath, temporaryRoot, {
      ...(options.stagingLimits || {}),
      freshClone: options.freshClone === true,
      executablePaths: options.executablePaths || [],
      symlinkPaths: options.symlinkPaths || []
    });
    report.verification.omittedPaths = staged.skippedSensitivePaths.slice().sort(compareStrings);
    const ignoredPaths = staged.skippedIgnoredPaths.slice().sort(compareStrings);
    report.verification.ignoredPathCount = ignoredPaths.length;
    report.verification.ignoredPaths = ignoredPaths.slice(0, MAX_IGNORED_PATHS);
    report.verification.ignoredPathsTruncated = ignoredPaths.length > report.verification.ignoredPaths.length;
    if (report.verification.ignoredPathCount > 0) {
      addFinding(report, {
        code: 'DOCKER_GITIGNORED_PATHS_SKIPPED',
        status: 'skipped',
        severity: 'info',
        title: 'Gitignored paths were omitted from the Docker snapshot',
        message: `CloneProof excluded ${report.verification.ignoredPathCount} path${report.verification.ignoredPathCount === 1 ? '' : 's'} ignored by the local checkout rules from Docker verification.`,
        evidence: report.verification.ignoredPaths
          .slice(0, MAX_IGNORED_PATH_EVIDENCE)
          .map((relative) => ({ path: relative, detail: 'Path matched the local Gitignore rules and was not staged.' })),
        recommendation: 'Use a fresh GitHub clone for repository-tracked content, or confirm that ignored paths are not required by the root workflow.'
      });
    }
    if (report.verification.omittedPaths.length > 0) {
      addFinding(report, {
        code: 'DOCKER_SENSITIVE_FILES_OMITTED',
        status: 'warning',
        severity: 'warning',
        title: 'Sensitive files were omitted from the Docker snapshot',
        message: 'CloneProof excluded sensitive configuration from the container snapshot, so verification does not cover those files.',
        evidence: report.verification.omittedPaths.map((relative) => ({ path: relative, detail: 'Sensitive file was not staged.' })),
        recommendation: 'Keep secrets out of the repository and use safe example configuration files for reproducibility.'
      });
    }
    if (staged.symlinkPaths.length > 0) {
      const symlinkCount = staged.symlinkPaths.length;
      const visibleSymlinkPaths = staged.symlinkPaths.slice(0, MAX_IGNORED_PATH_EVIDENCE);
      report.verification.stderr = `Symlinks were not staged (${symlinkCount} total): ${visibleSymlinkPaths.join(', ')}`;
      addFinding(report, {
        code: 'DOCKER_SYMLINKS_BLOCKED',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification was blocked by symlinks',
        message: `CloneProof refuses to stage ${symlinkCount} symlink${symlinkCount === 1 ? '' : 's'} into the verification container.`,
        evidence: visibleSymlinkPaths.map((relative) => ({ path: relative, detail: 'Symlink was not copied into the staged snapshot.' })),
        recommendation: 'Replace or remove symlinks before running the Docker workflow.'
      });
      report.status = 'blocked';
      return finalizeVerificationReport(report);
    }

    const args = dockerRunArguments(staged.destinationRoot, allowNetwork, containerName);
    const result = await runner(dockerCommand, args, { ...dockerContext, timeoutMs, maxOutputBytes });
    report.verification.outcome = result.exitCode === 0 && !result.error && !result.timedOut ? 'passed' : 'failed';
    report.verification.exitCode = result.exitCode;
    report.verification.signal = result.signal || null;
    report.verification.failedPhase = failedPhaseForResult(result);
    report.verification.timedOut = Boolean(result.timedOut);
    report.verification.outputTruncated = Boolean(result.outputTruncated);
    report.verification.stdout = redactOutput(result.stdout || '');
    report.verification.stderr = redactOutput(result.stderr || result.error || '');
    if (
      report.verification.failedPhase === 'install'
      && !allowNetwork
      && /(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH)/i.test(report.verification.stderr)
    ) {
      report.verification.outcome = 'blocked';
      const privateRegistryNote = report.findings.some((finding) => finding.code === 'PRIVATE_REGISTRY')
        ? ' Private registry credentials are probably needed for dependency installation.'
        : '';
      addFinding(report, {
        code: 'DOCKER_NETWORK_REQUIRED',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification requires network access',
        message: `npm ci failed while network access was disabled and reported a network error.${privateRegistryNote}`,
        evidence: makeEvidence('verification.stderr', 'The install output contained a network error.'),
        recommendation: 'Review the repository, then rerun with --allow-network if you trust it.'
      });
    }
    report.verification.cleanup = await cleanupContainer(
      runner,
      dockerCommand,
      containerName,
      result,
      { ...dockerContext, timeoutMs: DOCKER_PROBE_TIMEOUT_MS, maxOutputBytes: 16 * 1024 }
    );
    if (!report.verification.cleanup.completed) {
      addFinding(report, {
        code: 'DOCKER_CLEANUP_INCOMPLETE',
        status: 'failed',
        severity: 'error',
        title: 'Docker container cleanup could not be confirmed',
        message: 'CloneProof could not confirm that the timed-out or interrupted container was removed.',
        evidence: makeEvidence('verification', report.verification.cleanup.detail),
        recommendation: 'Stop and remove the reported container before running another verification.'
      });
      report.verification.outcome = 'failed';
    }
    if (report.verification.outcome !== 'blocked') {
      addFinding(report, verificationFinding(report.verification.outcome, report.verification, report));
    }
    recomputeSummary(report);
    report.status = report.verification.outcome === 'passed'
      ? (report.summary.warnings > 0 || report.verification.omittedPaths.length > 0 ? 'passed_with_warnings' : 'passed')
      : report.verification.outcome === 'blocked' ? 'blocked' : 'failed';
  } catch (error) {
    if (error && error.code === 'STAGING_LIMIT_EXCEEDED') {
      report.verification.outcome = 'blocked';
      report.verification.stderr = error.message;
      addFinding(report, {
        code: 'DOCKER_STAGING_LIMIT_EXCEEDED',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification was blocked by staging limits',
        message: error.message,
        evidence: makeEvidence('verification', 'No container was started because the repository snapshot exceeded the staging policy.'),
        recommendation: 'Reduce the repository snapshot or review the documented CloneProof staging limits before rerunning.'
      });
      report.status = 'blocked';
      return finalizeVerificationReport(report);
    }
    if (error && error.code === 'STAGING_SOURCE_CHANGED') {
      report.verification.outcome = 'blocked';
      report.verification.stderr = error.message;
      addFinding(report, {
        code: 'DOCKER_STAGING_SOURCE_CHANGED',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification was blocked because a file changed while staging',
        message: error.message,
        evidence: makeEvidence('verification', 'No container was started because the scanned repository changed during staging.'),
        recommendation: 'Run CloneProof against a stable checkout and rerun verification.'
      });
      report.status = 'blocked';
      return finalizeVerificationReport(report);
    }
    report.verification.outcome = 'failed';
    report.verification.stderr = error.message;
    addFinding(report, {
      code: 'DOCKER_VERIFICATION_ERROR',
      status: 'failed',
      severity: 'error',
      title: 'Docker verification could not be completed',
      message: error.message,
      evidence: makeEvidence('verification', 'The controlled staging or Docker invocation raised an error.'),
      recommendation: 'Review the local Docker setup and repository files, then rerun verification.'
    });
    report.status = 'failed';
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    fs.rmSync(dockerConfigRoot, { recursive: true, force: true });
    report.verification.cleanup.stagingRemoved = true;
    report.verification.cleanup.clientConfigRemoved = true;
    report.verification.cleanup.completed = Boolean(report.verification.cleanup.completed);
  }

  return finalizeVerificationReport(report);
}

module.exports = {
  DEFAULT_VERIFY_IMAGE,
  DEFAULT_SETUP_TIMEOUT_MS,
  dockerClientEnvironment,
  dockerRunArguments,
  runProcess,
  setupDocker,
  setupDockerImage,
  stageRepository,
  verifyRepository
};
