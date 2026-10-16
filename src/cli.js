#!/usr/bin/env node

const fs = require('node:fs');

const {
  cloneGithubRepository,
  isGithubRepositoryUrl,
  validateGithubUrl
} = require('./input/github');
const { scanRepository } = require('./scan/repository');
const { exitCodeForReport, renderHtml, renderJson, renderText } = require('./report/render');
const { verifyRepository } = require('./verify/docker');

const COMMANDS = new Set(['check', 'verify']);
const FORMATS = new Set(['text', 'json', 'html']);

function printHelp() {
  process.stdout.write([
    'CloneProof — repository setup verification',
    '',
    'Usage:',
    '  cloneproof check <repository-or-github-url> [--format text|json|html] [--output FILE]',
    '  cloneproof verify <repository-or-github-url> --docker --execute [--allow-network] [--timeout-ms N] [--format text|json|html] [--output FILE]',
    '',
    'Static check never executes repository code. Docker verification requires explicit --docker --execute consent.',
    'Network access is disabled unless --allow-network is also provided.',
    'GitHub input accepts only public https://github.com/OWNER/REPOSITORY URLs.',
    ''
  ].join('\n'));
}

function parseArguments(argv) {
  const values = argv.slice(2);
  if (values.length === 0 || values.includes('--help') || values.includes('-h')) {
    return { help: true };
  }

  const command = values.shift();
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  let target = null;
  let format = 'text';
  let color;
  let docker = false;
  let execute = false;
  let allowNetwork = false;
  let timeoutMs;
  let outputPath = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--format') {
      format = values[index + 1];
      index += 1;
      if (!FORMATS.has(format)) {
        throw new Error(`Unsupported format: ${format || '(missing)'}`);
      }
      continue;
    }
    if (value.startsWith('--format=')) {
      format = value.slice('--format='.length);
      if (!FORMATS.has(format)) {
        throw new Error(`Unsupported format: ${format || '(missing)'}`);
      }
      continue;
    }
    if (value === '--no-color') {
      color = false;
      continue;
    }
    if (value === '--output') {
      outputPath = values[index + 1];
      index += 1;
      if (!outputPath || outputPath.startsWith('-')) {
        throw new Error('Missing output file path');
      }
      continue;
    }
    if (value.startsWith('--output=')) {
      outputPath = value.slice('--output='.length);
      if (!outputPath) {
        throw new Error('Missing output file path');
      }
      continue;
    }
    if (value === '--color') {
      color = true;
      continue;
    }
    if (value === '--docker') {
      docker = true;
      continue;
    }
    if (value === '--execute') {
      execute = true;
      continue;
    }
    if (value === '--allow-network') {
      allowNetwork = true;
      continue;
    }
    if (value === '--timeout-ms') {
      timeoutMs = Number(values[index + 1]);
      index += 1;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid timeout: ${values[index] || '(missing)'}`);
      }
      continue;
    }
    if (value.startsWith('--timeout-ms=')) {
      timeoutMs = Number(value.slice('--timeout-ms='.length));
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid timeout: ${value.slice('--timeout-ms='.length) || '(missing)'}`);
      }
      continue;
    }
    if (value.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (target !== null) {
      throw new Error(`Unexpected extra argument: ${value}`);
    }
    target = value;
  }

  if (!target) {
    throw new Error(`${command} requires a repository path`);
  }

  if (command === 'check' && (allowNetwork || timeoutMs !== undefined || docker || execute)) {
    throw new Error('--docker, --execute, --allow-network, and --timeout-ms are only valid for verify');
  }

  if (outputPath && format !== 'html') {
    throw new Error('--output requires --format html');
  }

  return { command, target, format, color, docker, execute, allowNetwork, timeoutMs, outputPath };
}

function renderReport(report, format, color) {
  if (format === 'json') return renderJson(report);
  if (format === 'html') return renderHtml(report);
  return renderText(report, { color });
}

function writeReport(report, options) {
  const rendered = renderReport(report, options.format, options.color);
  if (options.outputPath) {
    fs.writeFileSync(options.outputPath, rendered, 'utf8');
  } else {
    process.stdout.write(rendered);
  }
}

function isRemoteTarget(target) {
  return /^https?:\/\//i.test(target);
}

function looksLikeGithubTargetWithoutScheme(target) {
  return /^(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+\/?$/i.test(target)
    || /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(target);
}

function isExistingDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function invalidGithubTargetError() {
  const error = new Error('Invalid GitHub repository URL: use https://github.com/OWNER/REPO');
  error.code = 'GITHUB_URL_INVALID';
  return error;
}

function cloneFailureStatus(error) {
  return error && (
    error.code === 'GITHUB_URL_INVALID'
    || error.code === 'GITHUB_CHECKOUT_LIMIT_EXCEEDED'
    || error.code === 'GITHUB_CHECKOUT_UNAVAILABLE'
    || error.code === 'GITHUB_REPOSITORY_TOO_LARGE'
    || error.code === 'GITHUB_REPOSITORY_UNAVAILABLE'
  )
    ? 'blocked'
    : 'incomplete';
}

function safeCloneTargetName(target) {
  try {
    return validateGithubUrl(target).repository;
  } catch {
    return isRemoteTarget(target) ? 'github-url' : String(target);
  }
}

function cloneFailureReport(target, error, mode) {
  const status = cloneFailureStatus(error);
  const findingStatus = status === 'incomplete' ? 'failed' : 'skipped';
  const targetName = safeCloneTargetName(target);
  const title = error && error.code === 'GITHUB_URL_INVALID'
    ? 'GitHub repository URL is not supported'
    : 'GitHub repository could not be staged';
  const message = error && error.message ? error.message : 'The GitHub repository could not be cloned.';
  const reportTarget = { kind: 'github', name: targetName };
  if (error && error.preflight) reportTarget.preflight = error.preflight;
  if (error && Number.isFinite(error.repositorySizeKb)) reportTarget.repositorySizeKb = error.repositorySizeKb;
  return {
    schemaVersion: 2,
    tool: 'cloneproof',
    mode,
    status,
    target: reportTarget,
    findings: [{
      code: error && error.code ? error.code : 'GITHUB_CLONE_FAILED',
      status: findingStatus,
      severity: findingStatus === 'failed' ? 'error' : 'warning',
      title,
      message,
      evidence: [{ path: targetName, detail: 'GitHub source input.' }],
      recommendation: status === 'blocked'
        ? 'Use a public HTTPS GitHub repository URL within the supported checkout limits.'
        : 'Check the public repository URL and Git installation, then rerun the command.'
    }],
    summary: {
      total: 1,
      passed: 0,
      failed: findingStatus === 'failed' ? 1 : 0,
      warnings: 0,
      skipped: findingStatus === 'skipped' ? 1 : 0
    }
  };
}

async function resolveTarget(target) {
  if (!isRemoteTarget(target)) {
    if (looksLikeGithubTargetWithoutScheme(target) && !isExistingDirectory(target)) {
      throw invalidGithubTargetError();
    }
    return { path: target, source: null };
  }

  // Validate before creating a temporary directory or starting git.
  validateGithubUrl(target);
  const source = await cloneGithubRepository(target);
  return { path: source.root, source };
}

function applySourceTarget(report, source) {
  if (!source) return report;
  report.target = {
    kind: 'github',
    name: source.repository,
    url: source.url,
    preflight: source.preflight,
    ...(source.repositorySizeKb === undefined ? {} : { repositorySizeKb: source.repositorySizeKb })
  };
  return report;
}

async function runCheck(options) {
  let resolved;
  try {
    resolved = await resolveTarget(options.target);
  } catch (error) {
    const report = cloneFailureReport(options.target, error, 'check');
    writeReport(report, options);
    return exitCodeForReport(report);
  }

  try {
    const report = applySourceTarget(
      scanRepository(resolved.path, { freshClone: Boolean(resolved.source) }),
      resolved.source
    );
    writeReport(report, options);
    return exitCodeForReport(report);
  } finally {
    if (resolved.source) await resolved.source.cleanup();
  }
}

async function runVerify(options) {
  if (!options.docker || !options.execute) {
    process.stderr.write('CloneProof: verify requires both --docker and --execute; no repository code was run.\n');
    return 2;
  }

  let resolved;
  try {
    resolved = await resolveTarget(options.target);
  } catch (error) {
    const report = cloneFailureReport(options.target, error, 'verify');
    writeReport(report, options);
    return exitCodeForReport(report);
  }

  try {
    const report = applySourceTarget(await verifyRepository(resolved.path, {
      execute: true,
      allowNetwork: options.allowNetwork,
      timeoutMs: options.timeoutMs,
      freshClone: Boolean(resolved.source)
    }), resolved.source);
    writeReport(report, options);
    return exitCodeForReport(report);
  } finally {
    if (resolved.source) await resolved.source.cleanup();
  }
}

async function run() {
  let options;
  try {
    options = parseArguments(process.argv);
  } catch (error) {
    process.stderr.write(`CloneProof: ${error.message}\n\n`);
    printHelp();
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  if (options.command === 'verify') {
    return runVerify(options);
  }

  return runCheck(options);
}

run().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`CloneProof: ${error.message}\n`);
  process.exitCode = 2;
});

module.exports = { parseArguments, renderReport };
