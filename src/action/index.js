'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { emitAnnotations } = require('./annotations');
const { isSubPath, normalizePathForComparison } = require('./paths');
const { renderJobSummary, writeJobSummary } = require('./summary');
const { DEFAULT_VERIFY_IMAGE } = require('../verify/docker');

const MINIMAL_PROCESS_ENV_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NO_COLOR',
  'FORCE_COLOR'
];

const VALID_REPORT_STATUSES = new Set([
  'passed',
  'passed_with_warnings',
  'failed',
  'blocked',
  'incomplete'
]);

const MIN_VERIFY_TIMEOUT_MS = 1000;
const DEFAULT_VERIFY_TIMEOUT_MS = 300000;
const MAX_VERIFY_TIMEOUT_MS = 600000;
const ALLOWED_VERIFY_EVENTS = new Set(['push', 'workflow_dispatch']);

function validateMode(rawMode) {
  if (rawMode === undefined || rawMode === null || String(rawMode).trim() === '') {
    return 'check';
  }
  const trimmed = String(rawMode).trim();
  if (trimmed === 'check' || trimmed === 'verify') {
    return trimmed;
  }
  throw new Error(`Invalid mode: "${rawMode}". Supported modes are "check" and "verify".`);
}

function validateAllowNetwork(rawAllowNetwork, mode = 'check') {
  let parsed = false;
  if (rawAllowNetwork === undefined || rawAllowNetwork === null || (typeof rawAllowNetwork === 'string' && rawAllowNetwork.trim() === '')) {
    parsed = false;
  } else if (rawAllowNetwork === true || rawAllowNetwork === 'true') {
    parsed = true;
  } else if (rawAllowNetwork === false || rawAllowNetwork === 'false') {
    parsed = false;
  } else {
    throw new Error(`Invalid allow-network value: "${rawAllowNetwork}". Must be "true" or "false".`);
  }

  if (mode === 'check' && parsed) {
    throw new Error('allow-network: true is not supported in "check" mode. Static check never accesses the network.');
  }

  return parsed;
}

function validateTimeoutMs(rawTimeoutMs) {
  if (rawTimeoutMs === undefined || rawTimeoutMs === null || String(rawTimeoutMs).trim() === '') {
    return DEFAULT_VERIFY_TIMEOUT_MS;
  }
  const str = String(rawTimeoutMs).trim();
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid timeout-ms: "${rawTimeoutMs}". Must be a positive integer between ${MIN_VERIFY_TIMEOUT_MS} and ${MAX_VERIFY_TIMEOUT_MS} ms.`);
  }
  const num = Number(str);
  if (num < MIN_VERIFY_TIMEOUT_MS || num > MAX_VERIFY_TIMEOUT_MS) {
    throw new Error(`Invalid timeout-ms: "${rawTimeoutMs}". Must be a positive integer between ${MIN_VERIFY_TIMEOUT_MS} and ${MAX_VERIFY_TIMEOUT_MS} ms.`);
  }
  return num;
}

function isLinuxRunner(platform, runnerOs) {
  const currentPlatform = arguments.length > 0 ? platform : process.platform;
  const currentRunnerOs = arguments.length > 1 ? runnerOs : process.env.RUNNER_OS;
  if (currentPlatform !== 'linux') return false;
  if (!currentRunnerOs || typeof currentRunnerOs !== 'string' || currentRunnerOs.trim().toLowerCase() !== 'linux') {
    return false;
  }
  return true;
}

function isAllowedVerifyEvent(eventName) {
  if (!eventName || typeof eventName !== 'string') {
    return false;
  }

  return ALLOWED_VERIFY_EVENTS.has(eventName.trim());
}

function recomputeReportSummary(report) {
  if (!report || !Array.isArray(report.findings)) return;
  report.summary = {
    total: report.findings.length,
    passed: report.findings.filter((finding) => finding.status === 'passed').length,
    failed: report.findings.filter((finding) => finding.status === 'failed').length,
    warnings: report.findings.filter((finding) => finding.status === 'warning').length,
    skipped: report.findings.filter((finding) => finding.status === 'skipped').length
  };
}

function makeBlockedVerificationObject({
  allowNetwork = false,
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
  image = DEFAULT_VERIFY_IMAGE,
  setupFailed = false,
  errorMessage = ''
} = {}) {
  return {
    requested: true,
    authorized: false,
    image,
    networkMode: allowNetwork ? 'bridge' : 'none',
    networkConsent: Boolean(allowNetwork),
    timeoutMs,
    maxOutputBytes: 10 * 1024 * 1024,
    commands: [
      'copy the scanned repository snapshot into the container',
      'npm ci --ignore-scripts',
      'npm test'
    ],
    outcome: 'blocked',
    dockerAvailable: false,
    imageAvailable: false,
    dockerExecutable: null,
    exitCode: null,
    signal: null,
    failedPhase: null,
    timedOut: false,
    outputTruncated: false,
    noTestsRan: false,
    stdout: '',
    stderr: errorMessage,
    omittedPaths: [],
    ignoredPaths: [],
    ignoredPathCount: 0,
    ignoredPathsTruncated: false,
    cleanup: { attempted: false, completed: true, stagingRemoved: false, clientConfigRemoved: false, stagingAttempted: false },
    setupFailed: Boolean(setupFailed)
  };
}

function sanitizeWorkflowCommandText(text) {
  if (typeof text !== 'string') return '';
  return text.split('\n').map((line) => {
    if (line.startsWith('::')) {
      return ' ' + line;
    }
    return line;
  }).join('\n');
}

function pipeSanitizedOutput(stream, destination) {
  if (!stream || typeof stream.on !== 'function') return;
  let remainder = '';
  stream.on('data', (chunk) => {
    const text = remainder + chunk.toString('utf8');
    const lines = text.split('\n');
    remainder = lines.pop();
    for (const line of lines) {
      const sanitized = line.startsWith('::') ? ' ' + line : line;
      if (destination && typeof destination.write === 'function') {
        destination.write(sanitized + '\n');
      }
    }
  });
  stream.on('end', () => {
    if (remainder.length > 0) {
      const sanitized = remainder.startsWith('::') ? ' ' + remainder : remainder;
      if (destination && typeof destination.write === 'function') {
        destination.write(sanitized);
      }
    }
  });
}

function getActionInput(name, env = process.env) {
  const exactKey = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  const underscoredKey = `INPUT_${name.replace(/[ -]/g, '_').toUpperCase()}`;
  const value = env[exactKey] !== undefined ? env[exactKey] : env[underscoredKey];
  return typeof value === 'string' ? value : '';
}

function exportOutput(outputFilePath, name, value) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid output name: ${name}`);
  }
  const stringValue = String(value);
  if (stringValue.includes('\n') || stringValue.includes('\r')) {
    throw new Error(`Output value for "${name}" contains forbidden newline characters.`);
  }
  fs.appendFileSync(outputFilePath, `${name}=${stringValue}\n`, 'utf8');
}

function validateRequiredEnvironment(env = process.env, rawReportPath = '') {
  if (!env.GITHUB_WORKSPACE || typeof env.GITHUB_WORKSPACE !== 'string' || env.GITHUB_WORKSPACE.trim() === '') {
    throw new Error('GITHUB_WORKSPACE environment variable is missing or empty.');
  }
  if (!env.GITHUB_OUTPUT || typeof env.GITHUB_OUTPUT !== 'string' || env.GITHUB_OUTPUT.trim() === '') {
    throw new Error('GITHUB_OUTPUT environment variable is missing or empty.');
  }
  if ((!rawReportPath || rawReportPath.trim() === '') && (!env.RUNNER_TEMP || typeof env.RUNNER_TEMP !== 'string' || env.RUNNER_TEMP.trim() === '')) {
    throw new Error('RUNNER_TEMP environment variable is missing or empty.');
  }
}

function validateTargetPath(rawTarget, workspacePath) {
  const targetString = typeof rawTarget === 'string' && rawTarget.trim() !== '' ? rawTarget.trim() : '.';
  const normalizedTarget = targetString.replace(/\\/g, '/');
  const resolvedTarget = path.isAbsolute(targetString) || /^[a-zA-Z]:[/\\]/.test(targetString)
    ? path.resolve(targetString)
    : path.resolve(workspacePath, normalizedTarget);

  if (!isSubPath(workspacePath, resolvedTarget)) {
    throw new Error(`Target path "${targetString}" resolves outside GITHUB_WORKSPACE.`);
  }

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target directory does not exist: ${resolvedTarget}`);
  }

  const stat = fs.statSync(resolvedTarget);
  if (!stat.isDirectory()) {
    throw new Error(`Target path must be a directory: ${resolvedTarget}`);
  }

  if (fs.existsSync(workspacePath)) {
    const realWorkspace = fs.realpathSync(workspacePath);
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!isSubPath(realWorkspace, realTarget)) {
      throw new Error(`Target path "${targetString}" points outside GITHUB_WORKSPACE via symlink.`);
    }
  }

  return resolvedTarget;
}

function validateReportPath(rawReportPath, workspacePath, runnerTemp, targetPath) {
  const reportString = typeof rawReportPath === 'string' ? rawReportPath.trim() : '';

  if (!reportString) {
    if (!runnerTemp) {
      throw new Error('RUNNER_TEMP environment variable is missing or empty.');
    }
    const resolvedRunnerTemp = path.resolve(runnerTemp);
    const dedicatedDir = path.join(resolvedRunnerTemp, 'cloneproof');
    fs.mkdirSync(dedicatedDir, { recursive: true });
    const defaultReportPath = path.join(dedicatedDir, 'report.json');

    if (targetPath && isSubPath(targetPath, defaultReportPath)) {
      throw new Error('Default report path must not be inside the target repository.');
    }
    return defaultReportPath;
  }

  const resolved = path.isAbsolute(reportString) || /^[a-zA-Z]:[/\\]/.test(reportString)
    ? path.resolve(reportString)
    : path.resolve(workspacePath, reportString.replace(/\\/g, '/'));

  const inWorkspace = isSubPath(workspacePath, resolved);
  const inRunnerTemp = runnerTemp ? isSubPath(path.resolve(runnerTemp), resolved) : false;

  if (!inWorkspace && !inRunnerTemp) {
    throw new Error(`Report destination "${reportString}" must resolve inside GITHUB_WORKSPACE or RUNNER_TEMP.`);
  }

  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }

  if (stat) {
    if (stat.isDirectory()) {
      throw new Error(`Report destination "${reportString}" is a directory, expected a file path.`);
    }
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync(resolved);
      const realWorkspace = fs.realpathSync(workspacePath);
      const realTemp = runnerTemp && fs.existsSync(runnerTemp) ? fs.realpathSync(runnerTemp) : null;
      const realInWorkspace = isSubPath(realWorkspace, real);
      const realInTemp = realTemp ? isSubPath(realTemp, real) : false;
      if (!realInWorkspace && !realInTemp) {
        throw new Error(`Report destination "${reportString}" is a symlink pointing outside allowed directories.`);
      }
    }
  }

  let current = path.dirname(resolved);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      const realDir = fs.realpathSync(current);
      const realWorkspace = fs.realpathSync(workspacePath);
      const realTemp = runnerTemp && fs.existsSync(runnerTemp) ? fs.realpathSync(runnerTemp) : null;
      const realInWorkspace = isSubPath(realWorkspace, realDir);
      const realInTemp = realTemp ? isSubPath(realTemp, realDir) : false;
      if (!realInWorkspace && !realInTemp) {
        throw new Error(`Report destination parent directory "${current}" resolves outside allowed directories.`);
      }
      break;
    }
    current = path.dirname(current);
  }

  return resolved;
}

function resolveCliEntrypoint(actionPath) {
  const basePath = actionPath ? path.resolve(actionPath) : path.resolve(__dirname, '..', '..');
  const cliCandidate = path.resolve(basePath, 'src', 'cli.js');
  if (!fs.existsSync(cliCandidate)) {
    throw new Error(`CloneProof CLI entrypoint not found at ${cliCandidate}`);
  }
  return cliCandidate;
}

function filterChildEnvironment(sourceEnv = process.env) {
  const filtered = {};
  for (const key of MINIMAL_PROCESS_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) {
      filtered[key] = sourceEnv[key];
    }
  }
  return filtered;
}

function validateReportStructure(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Report is not a valid JSON object.');
  }
  if (report.schemaVersion !== 2) {
    throw new Error(`Unsupported report schemaVersion: ${report.schemaVersion}`);
  }
  if (report.tool !== 'cloneproof') {
    throw new Error(`Unexpected report tool identifier: ${report.tool}`);
  }
  if (typeof report.status !== 'string' || !VALID_REPORT_STATUSES.has(report.status)) {
    throw new Error(`Invalid or missing report status: ${report.status}`);
  }
  if (!Array.isArray(report.findings)) {
    throw new Error('Report findings must be an array.');
  }
}

function readAndValidateReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report was not created at expected destination: ${reportPath}`);
  }
  let reportContent;
  try {
    reportContent = fs.readFileSync(reportPath, 'utf8');
  } catch (readError) {
    throw new Error(`Failed to read report file at ${reportPath}: ${readError.message}`);
  }
  let report;
  try {
    report = JSON.parse(reportContent);
  } catch (parseError) {
    throw new Error(`Report file at ${reportPath} contains malformed JSON: ${parseError.message}`);
  }
  validateReportStructure(report);
  return report;
}

function spawnAndCapture(spawnFn, execPath, args, options, stdout, stderr) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(execPath, args, options);
    if (child.stdout) {
      pipeSanitizedOutput(child.stdout, stdout);
    }
    if (child.stderr) {
      pipeSanitizedOutput(child.stderr, stderr);
    }
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

async function runAction(options = {}) {
  const env = options.env || process.env;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const spawnFn = options.spawn || spawn;
  const execPath = options.execPath || process.execPath;
  const platform = options.platform || process.platform;

  const rawMode = options.mode !== undefined
    ? options.mode
    : getActionInput('mode', env);
  const mode = validateMode(rawMode);

  const rawAllowNetwork = options.allowNetwork !== undefined
    ? options.allowNetwork
    : getActionInput('allow-network', env);
  const allowNetwork = validateAllowNetwork(rawAllowNetwork, mode);

  const rawTimeoutMs = options.timeoutMs !== undefined
    ? options.timeoutMs
    : getActionInput('timeout-ms', env);
  const timeoutMs = validateTimeoutMs(rawTimeoutMs);

  const rawTarget = options.targetPath !== undefined
    ? options.targetPath
    : getActionInput('target-path', env);

  const rawReport = options.reportPath !== undefined
    ? options.reportPath
    : getActionInput('report-path', env);

  validateRequiredEnvironment(env, rawReport);

  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const resolvedTarget = validateTargetPath(rawTarget, workspace);
  const resolvedReport = validateReportPath(rawReport, workspace, env.RUNNER_TEMP, resolvedTarget);
  const cliPath = resolveCliEntrypoint(env.GITHUB_ACTION_PATH);

  const childEnv = filterChildEnvironment(env);
  const spawnOpts = {
    cwd: workspace,
    env: childEnv,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  };

  if (mode === 'check') {
    const childExitCode = await spawnAndCapture(
      spawnFn,
      execPath,
      [cliPath, 'check', resolvedTarget, '--format', 'json', '--output', resolvedReport],
      spawnOpts,
      stdout,
      stderr
    );

    const report = readAndValidateReport(resolvedReport);

    exportOutput(env.GITHUB_OUTPUT, 'status', report.status);
    exportOutput(env.GITHUB_OUTPUT, 'report-path', resolvedReport);
    exportOutput(env.GITHUB_OUTPUT, 'verification-status', 'not_run');

    let annotationResult = null;
    try {
      annotationResult = emitAnnotations(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        destination: stdout
      });
    } catch (annotationError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate annotations: ${annotationError.message}\n`);
      }
    }

    try {
      const summaryMarkdown = renderJobSummary(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        runnerTemp: env.RUNNER_TEMP,
        reportPath: resolvedReport,
        omittedAnnotationCount: annotationResult ? annotationResult.omittedCount : 0
      });
      writeJobSummary(summaryMarkdown, env.GITHUB_STEP_SUMMARY, stderr);
    } catch (summaryError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate job summary: ${summaryError.message}\n`);
      }
    }

    let finalExitCode = childExitCode;
    if (finalExitCode === 0) {
      if (report.status === 'failed') {
        finalExitCode = 1;
      } else if (report.status === 'blocked' || report.status === 'incomplete') {
        finalExitCode = 2;
      }
    }

    return finalExitCode;
  }

  // mode === 'verify'
  const runnerOs = options.runnerOs !== undefined ? options.runnerOs : env.RUNNER_OS;
  const eventName = options.eventName !== undefined ? options.eventName : env.GITHUB_EVENT_NAME;
  const isLinux = isLinuxRunner(platform, runnerOs);
  const isEventAllowed = isAllowedVerifyEvent(eventName);

  if (!isLinux || !isEventAllowed) {
    // Run safe static check to preserve report experience without executing code
    await spawnAndCapture(
      spawnFn,
      execPath,
      [cliPath, 'check', resolvedTarget, '--format', 'json', '--output', resolvedReport],
      spawnOpts,
      stdout,
      stderr
    );

    const report = readAndValidateReport(resolvedReport);

    report.mode = 'verify';
    if (!isLinux) {
      report.findings.push({
        code: 'DOCKER_UNAVAILABLE',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification unsupported on this runner',
        message: `Docker verification is currently supported only on Linux runners (detected ${runnerOs || platform}).`,
        evidence: [{ path: 'runner', detail: `RUNNER_OS=${runnerOs || '(none)'}, platform=${platform}` }],
        recommendation: 'Run Docker verification on an ubuntu-latest or Linux runner.'
      });
    } else {
      report.findings.push({
        code: 'DOCKER_EXECUTION_CONSENT_REQUIRED',
        status: 'skipped',
        severity: 'warning',
        title: 'Docker verification is restricted to push and workflow_dispatch events',
        message: `Docker verification was blocked because event "${eventName || '(missing)'}" is not permitted to execute verification containers.`,
        evidence: [{ path: 'workflow', detail: `GITHUB_EVENT_NAME=${eventName || '(missing)'}` }],
        recommendation: 'Configure verification to run on push or workflow_dispatch events.'
      });
    }

    report.status = 'blocked';
    recomputeReportSummary(report);
    report.verification = makeBlockedVerificationObject({
      allowNetwork,
      timeoutMs,
      image: DEFAULT_VERIFY_IMAGE,
      setupFailed: false,
      errorMessage: !isLinux
        ? `Docker verification is currently supported only on Linux runners (detected ${runnerOs || platform}).`
        : `Docker verification was blocked because event "${eventName || '(missing)'}" is not permitted to execute verification containers.`
    });

    fs.writeFileSync(resolvedReport, JSON.stringify(report, null, 2), 'utf8');

    exportOutput(env.GITHUB_OUTPUT, 'status', 'blocked');
    exportOutput(env.GITHUB_OUTPUT, 'report-path', resolvedReport);
    exportOutput(env.GITHUB_OUTPUT, 'verification-status', 'blocked');

    let annotationResult = null;
    try {
      annotationResult = emitAnnotations(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        destination: stdout
      });
    } catch (annotationError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate annotations: ${annotationError.message}\n`);
      }
    }

    try {
      const summaryMarkdown = renderJobSummary(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        runnerTemp: env.RUNNER_TEMP,
        reportPath: resolvedReport,
        omittedAnnotationCount: annotationResult ? annotationResult.omittedCount : 0
      });
      writeJobSummary(summaryMarkdown, env.GITHUB_STEP_SUMMARY, stderr);
    } catch (summaryError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate job summary: ${summaryError.message}\n`);
      }
    }

    return 2;
  }

  // Prepare Docker image using setup
  const setupExitCode = await spawnAndCapture(
    spawnFn,
    execPath,
    [cliPath, 'setup'],
    spawnOpts,
    stdout,
    stderr
  );

  if (setupExitCode !== 0) {
    // Setup failed - run static check, mark blocked
    await spawnAndCapture(
      spawnFn,
      execPath,
      [cliPath, 'check', resolvedTarget, '--format', 'json', '--output', resolvedReport],
      spawnOpts,
      stdout,
      stderr
    );

    const report = readAndValidateReport(resolvedReport);
    report.mode = 'verify';

    report.findings.push({
      code: 'DOCKER_IMAGE_UNAVAILABLE',
      status: 'skipped',
      severity: 'warning',
      title: 'CloneProof Docker setup failed',
      message: 'Failed to prepare the pinned Docker image; repository verification was not started.',
      evidence: [{ path: 'docker', detail: 'cli setup returned non-zero exit code' }],
      recommendation: 'Check Docker daemon status and permissions, then rerun verification.'
    });

    report.status = 'blocked';
    recomputeReportSummary(report);
    report.verification = makeBlockedVerificationObject({
      allowNetwork,
      timeoutMs,
      image: DEFAULT_VERIFY_IMAGE,
      setupFailed: true,
      errorMessage: 'Failed to prepare the pinned Docker image; repository verification was not started.'
    });

    fs.writeFileSync(resolvedReport, JSON.stringify(report, null, 2), 'utf8');

    exportOutput(env.GITHUB_OUTPUT, 'status', 'blocked');
    exportOutput(env.GITHUB_OUTPUT, 'report-path', resolvedReport);
    exportOutput(env.GITHUB_OUTPUT, 'verification-status', 'blocked');

    let annotationResult = null;
    try {
      annotationResult = emitAnnotations(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        destination: stdout
      });
    } catch (annotationError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate annotations: ${annotationError.message}\n`);
      }
    }

    try {
      const summaryMarkdown = renderJobSummary(report, {
        workspaceRoot: workspace,
        targetRoot: resolvedTarget,
        runnerTemp: env.RUNNER_TEMP,
        reportPath: resolvedReport,
        omittedAnnotationCount: annotationResult ? annotationResult.omittedCount : 0
      });
      writeJobSummary(summaryMarkdown, env.GITHUB_STEP_SUMMARY, stderr);
    } catch (summaryError) {
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`CloneProof Action: failed to generate job summary: ${summaryError.message}\n`);
      }
    }

    return 2;
  }

  // Setup succeeded - run authoritative verify
  const verifyArgs = [
    cliPath,
    'verify',
    resolvedTarget,
    '--docker',
    '--execute',
    '--format',
    'json',
    '--output',
    resolvedReport,
    '--timeout-ms',
    String(timeoutMs)
  ];
  if (allowNetwork) {
    verifyArgs.push('--allow-network');
  }

  const childExitCode = await spawnAndCapture(
    spawnFn,
    execPath,
    verifyArgs,
    spawnOpts,
    stdout,
    stderr
  );

  const report = readAndValidateReport(resolvedReport);

  const verificationOutcome = report.verification && typeof report.verification.outcome === 'string'
    ? report.verification.outcome
    : 'error';

  exportOutput(env.GITHUB_OUTPUT, 'status', report.status);
  exportOutput(env.GITHUB_OUTPUT, 'report-path', resolvedReport);
  exportOutput(env.GITHUB_OUTPUT, 'verification-status', verificationOutcome);

  let annotationResult = null;
  try {
    annotationResult = emitAnnotations(report, {
      workspaceRoot: workspace,
      targetRoot: resolvedTarget,
      destination: stdout
    });
  } catch (annotationError) {
    if (stderr && typeof stderr.write === 'function') {
      stderr.write(`CloneProof Action: failed to generate annotations: ${annotationError.message}\n`);
    }
  }

  try {
    const summaryMarkdown = renderJobSummary(report, {
      workspaceRoot: workspace,
      targetRoot: resolvedTarget,
      runnerTemp: env.RUNNER_TEMP,
      reportPath: resolvedReport,
      omittedAnnotationCount: annotationResult ? annotationResult.omittedCount : 0
    });
    writeJobSummary(summaryMarkdown, env.GITHUB_STEP_SUMMARY, stderr);
  } catch (summaryError) {
    if (stderr && typeof stderr.write === 'function') {
      stderr.write(`CloneProof Action: failed to generate job summary: ${summaryError.message}\n`);
    }
  }

  let finalExitCode = childExitCode;
  if (finalExitCode === 0) {
    if (report.status === 'failed' || verificationOutcome === 'failed') {
      finalExitCode = 1;
    } else if (report.status === 'blocked' || report.status === 'incomplete' || verificationOutcome === 'blocked') {
      finalExitCode = 2;
    }
  }

  return finalExitCode;
}

if (require.main === module) {
  runAction().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`CloneProof Action: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = {
  ALLOWED_VERIFY_EVENTS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  MAX_VERIFY_TIMEOUT_MS,
  MIN_VERIFY_TIMEOUT_MS,
  MINIMAL_PROCESS_ENV_KEYS,
  VALID_REPORT_STATUSES,
  emitAnnotations,
  exportOutput,
  filterChildEnvironment,
  getActionInput,
  isAllowedVerifyEvent,
  isLinuxRunner,
  isSubPath,
  makeBlockedVerificationObject,
  normalizePathForComparison,
  pipeSanitizedOutput,
  readAndValidateReport,
  recomputeReportSummary,
  renderJobSummary,
  resolveCliEntrypoint,
  runAction,
  sanitizeWorkflowCommandText,
  validateAllowNetwork,
  validateMode,
  validateReportPath,
  validateReportStructure,
  validateRequiredEnvironment,
  validateTargetPath,
  validateTimeoutMs,
  writeJobSummary
};
