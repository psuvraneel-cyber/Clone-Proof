'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function normalizePathForComparison(targetPath) {
  let resolved = path.resolve(targetPath);
  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
  }
  return resolved;
}

function isSubPath(parentPath, childPath) {
  const normParent = normalizePathForComparison(parentPath);
  const normChild = normalizePathForComparison(childPath);
  const rel = path.relative(normParent, normChild);
  if (rel === '') return true;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
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
  const resolvedTarget = path.isAbsolute(targetString)
    ? path.resolve(targetString)
    : path.resolve(workspacePath, targetString);

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

  const resolved = path.isAbsolute(reportString)
    ? path.resolve(reportString)
    : path.resolve(workspacePath, reportString);

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

async function runAction(options = {}) {
  const env = options.env || process.env;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const spawnFn = options.spawn || spawn;
  const execPath = options.execPath || process.execPath;

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

  const child = spawnFn(execPath, [
    cliPath,
    'check',
    resolvedTarget,
    '--format',
    'json',
    '--output',
    resolvedReport
  ], {
    cwd: workspace,
    env: childEnv,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (child.stdout) {
    pipeSanitizedOutput(child.stdout, stdout);
  }
  if (child.stderr) {
    pipeSanitizedOutput(child.stderr, stderr);
  }

  const childExitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 0);
      }
    });
  });

  if (!fs.existsSync(resolvedReport)) {
    throw new Error(`Report was not created at expected destination: ${resolvedReport}`);
  }

  let reportContent;
  try {
    reportContent = fs.readFileSync(resolvedReport, 'utf8');
  } catch (readError) {
    throw new Error(`Failed to read report file at ${resolvedReport}: ${readError.message}`);
  }

  let report;
  try {
    report = JSON.parse(reportContent);
  } catch (parseError) {
    throw new Error(`Report file at ${resolvedReport} contains malformed JSON: ${parseError.message}`);
  }

  validateReportStructure(report);

  exportOutput(env.GITHUB_OUTPUT, 'status', report.status);
  exportOutput(env.GITHUB_OUTPUT, 'report-path', resolvedReport);

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

if (require.main === module) {
  runAction().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`CloneProof Action: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = {
  MINIMAL_PROCESS_ENV_KEYS,
  VALID_REPORT_STATUSES,
  exportOutput,
  filterChildEnvironment,
  getActionInput,
  isSubPath,
  normalizePathForComparison,
  pipeSanitizedOutput,
  resolveCliEntrypoint,
  runAction,
  sanitizeWorkflowCommandText,
  validateReportPath,
  validateReportStructure,
  validateRequiredEnvironment,
  validateTargetPath
};
