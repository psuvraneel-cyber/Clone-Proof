#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { version: PACKAGE_VERSION } = require('../package.json');

const {
  cloneGithubRepository,
  isGithubRepositoryUrl,
  validateGithubUrl
} = require('./input/github');
const { scanRepository } = require('./scan/repository');
const { exitCodeForReport, renderHtml, renderJson, renderText } = require('./report/render');
const { createCoverage } = require('./report/coverage');
const { setupDockerImage, verifyRepository } = require('./verify/docker');
const { sanitizeValue } = require('./util/sanitize-paths');
const {
  MAX_RECEIPT_BYTES,
  createReceipt,
  readLocalGitMetadata,
  serializeReceipt,
  verifyReceiptContent,
  writeFileAtomic
} = require('./receipt');

const COMMANDS = new Set(['check', 'verify', 'setup', 'receipt']);
const FORMATS = new Set(['text', 'json', 'html']);

function printHelp() {
  process.stdout.write([
    'CloneProof — repository setup verification',
    '',
    'Usage:',
    '  cloneproof --version',
    '  cloneproof check <repository-or-github-url> [--require-tests] [--format text|json|html] [--output FILE] [--receipt FILE] [--color|--no-color]',
    '  cloneproof verify <repository-or-github-url> --docker --execute [--allow-network] [--timeout-ms N] [--require-tests] [--format text|json|html] [--output FILE] [--receipt FILE] [--color|--no-color]',
    '  cloneproof setup',
    '  cloneproof receipt verify <receipt-file>',
    '',
    '--receipt FILE also writes a reproducibility receipt (a JSON evidence record with a SHA-256 integrity digest).',
    'A receipt digest is not a signature: it detects changes only when the expected digest is trusted independently.',
    'Static check never executes repository code. Docker verification requires explicit --docker --execute consent.',
    'Docker verification network access is disabled unless --allow-network is also provided.',
    'A repository without tests gets a NO_TESTS_FOUND warning; --require-tests makes it a failure.',
    'Text output uses color only on a TTY; use --color or --no-color. NO_COLOR always disables ANSI color.',
    'GitHub input accepts only public https://github.com/OWNER/REPOSITORY URLs.',
    ''
  ].join('\n'));
}

function parseArguments(argv) {
  const values = argv.slice(2);
  if (values.length === 1 && values[0] === '--version') {
    return { version: true };
  }
  if (values.length === 0 || values.includes('--help') || values.includes('-h')) {
    return { help: true };
  }

  const command = values.shift();
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  if (command === 'receipt') {
    return parseReceiptArguments(values);
  }

  let target = null;
  let format = 'text';
  let color;
  let docker = false;
  let execute = false;
  let allowNetwork = false;
  let requireTests = false;
  let timeoutMs;
  let outputPath = null;
  let receiptPath = null;

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
    if (value === '--receipt') {
      receiptPath = values[index + 1];
      index += 1;
      if (!receiptPath || receiptPath.startsWith('-')) {
        throw new Error('Missing receipt file path');
      }
      continue;
    }
    if (value.startsWith('--receipt=')) {
      receiptPath = value.slice('--receipt='.length);
      if (!receiptPath) {
        throw new Error('Missing receipt file path');
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
    if (value === '--require-tests') {
      requireTests = true;
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

  if (command === 'setup' && target !== null) {
    throw new Error('setup does not accept a repository path');
  }

  if (command !== 'setup' && !target) {
    throw new Error(`${command} requires a repository path`);
  }

  if (command === 'setup' && format !== 'text') {
    throw new Error('setup only supports text output');
  }

  if (command === 'setup' && (outputPath || allowNetwork || requireTests || timeoutMs !== undefined || docker || execute)) {
    throw new Error('setup does not accept Docker, output, or verification options');
  }

  if (command === 'setup' && receiptPath) {
    throw new Error('setup does not accept --receipt');
  }

  if (receiptPath && outputPath && sameDestination(receiptPath, outputPath)) {
    throw new Error('--receipt and --output must name different files');
  }

  if (command === 'check' && (allowNetwork || timeoutMs !== undefined || docker || execute)) {
    throw new Error('--docker, --execute, --allow-network, and --timeout-ms are only valid for verify');
  }

  return {
    command,
    target,
    format,
    color,
    docker,
    execute,
    allowNetwork,
    timeoutMs,
    outputPath,
    ...(receiptPath ? { receiptPath } : {}),
    ...(requireTests ? { requireTests } : {})
  };
}

function parseReceiptArguments(values) {
  const [subcommand, receiptFile, ...extra] = values;
  if (subcommand !== 'verify') {
    throw new Error(`Unknown receipt subcommand: ${subcommand || '(missing)'}`);
  }
  if (!receiptFile || receiptFile.startsWith('-')) {
    throw new Error('receipt verify requires a receipt file path');
  }
  if (extra.length > 0) {
    throw new Error(`Unexpected extra argument: ${extra[0]}`);
  }
  return { command: 'receipt', subcommand, receiptFile };
}

function sameDestination(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function renderReport(report, format, color) {
  if (format === 'json') return renderJson(report);
  if (format === 'html') return renderHtml(report);
  return renderText(report, { color });
}

function writeReport(report, options) {
  const rendered = renderReport(report, options.format, options.outputPath ? false : options.color);
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.outputPath)), { recursive: true });
    fs.writeFileSync(options.outputPath, rendered, 'utf8');
    process.stderr.write(`CloneProof: wrote report to ${options.outputPath}\n`);
  } else {
    process.stdout.write(rendered);
  }
}

function prepareReceiptDestination(receiptPath) {
  const resolved = path.resolve(receiptPath);
  let stat = null;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw new Error('The receipt destination could not be inspected.');
  }
  if (stat && stat.isDirectory()) throw new Error('The receipt destination is a directory; expected a file path.');
  if (stat && stat.isSymbolicLink()) throw new Error('The receipt destination must not be a symbolic link.');
  if (stat && !stat.isFile()) throw new Error('The receipt destination is not a regular file.');
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } catch {
    throw new Error('The receipt destination folder could not be created.');
  }
  return resolved;
}

/**
 * Write a receipt for a finalized report. Receipt failures are reported
 * separately and never change the report or the command's exit code.
 */
function writeReceiptForReport(report, options, resolved) {
  if (!options.receiptPath) return null;
  try {
    const destination = prepareReceiptDestination(options.receiptPath);
    const git = resolved && !resolved.source
      ? readLocalGitMetadata(path.resolve(resolved.path))
      : null;
    const receipt = createReceipt({ report, invocation: 'cli', git, env: process.env });
    writeFileAtomic(destination, serializeReceipt(receipt));
    process.stderr.write(`CloneProof: wrote receipt to ${options.receiptPath} (sha256 ${receipt.integrity.digest})\n`);
    return receipt;
  } catch (error) {
    const reason = error && error.message ? error.message : 'Unknown error.';
    process.stderr.write(`CloneProof: receipt was not created: ${reason} The report and exit code are unaffected.\n`);
    return null;
  }
}

function isRemoteTarget(target) {
  return /^https?:\/\//i.test(target);
}

function githubRepositorySuggestion(target) {
  if (typeof target !== 'string' || target.length === 0) return null;

  let normalized = target.replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);

  let match = /^(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/i.exec(normalized);
  if (!match) {
    match = /^git@github\.com:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$/i.exec(normalized);
  }
  if (!match) {
    match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(normalized);
  }
  if (!match) return null;

  return `Did you mean https://github.com/${match[1]}/${match[2]}?`;
}

function addGithubRepositorySuggestion(report, suggestion) {
  if (!report || !suggestion || !Array.isArray(report.findings)) return;
  const finding = report.findings.find((item) => item && item.code === 'SCAN_ROOT_UNAVAILABLE');
  if (!finding || typeof finding.message !== 'string' || finding.message.includes(suggestion)) return;
  finding.message = `${finding.message} ${suggestion}`;
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
  const reportTarget = {
    kind: 'github',
    name: targetName,
    preflightAuthenticated: Boolean(error && error.preflightAuthenticated === true),
    ...(error && error.preflightReason ? { preflightReason: error.preflightReason } : {}),
    ...(error && error.preflightTokenRejected === true ? { preflightTokenRejected: true } : {}),
    ...(error && error.cleanupError ? { cleanupFailed: true } : {})
  };
  if (error && error.preflight) reportTarget.preflight = error.preflight;
  if (error && Number.isFinite(error.repositorySizeKb)) reportTarget.repositorySizeKb = error.repositorySizeKb;
  return sanitizeValue({
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
    },
    coverage: createCoverage()
  }, { temporaryPaths: error && Array.isArray(error.temporaryPaths) ? error.temporaryPaths : [] });
}

function cleanupDirectoryName(value) {
  const normalized = String(value || '').replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || 'temporary-folder';
}

function reportCleanupFailure(report, error) {
  const cleanup = report && report.verification && report.verification.cleanup;
  const cleanupDirectory = error && (error.cleanupDirectory || error.directory)
    || cleanup && cleanup.cleanupDirectory;
  if (!cleanupDirectory) return false;
  const folderName = cleanupDirectoryName(cleanupDirectory);
  if (report && report.target && report.target.kind === 'github') report.target.cleanupFailed = true;
  if (cleanup) {
    cleanup.cleanupFailed = true;
    cleanup.stagingRemoved = false;
  }
  if (report && (report.status === 'passed' || report.status === 'passed_with_warnings')) {
    report.status = report.mode === 'verify' ? 'failed' : 'incomplete';
  }
  process.stderr.write(`CloneProof: could not remove temporary folder ${folderName}; it is safe to delete.\n`);
  return true;
}

async function resolveTarget(target) {
  if (!isRemoteTarget(target)) {
    const suggestion = !fs.existsSync(target) ? githubRepositorySuggestion(target) : null;
    return {
      path: target,
      source: null,
      ...(suggestion ? { localGithubSuggestion: suggestion } : {})
    };
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
    preflightReason: source.preflightReason,
    preflightAuthenticated: source.preflightAuthenticated === true,
    ...(source.preflightTokenRejected === true ? { preflightTokenRejected: true } : {}),
    ...(source.repositorySizeKb === undefined ? {} : { repositorySizeKb: source.repositorySizeKb }),
    ...(source.executableModes === undefined ? {} : { executableModes: source.executableModes }),
    ...(typeof source.commit === 'string' && /^[0-9a-f]{40}$/i.test(source.commit)
      ? { commit: source.commit }
      : {})
  };
  return report;
}

function reportPreflightNotice(source) {
  if (source && source.preflightTokenRejected === true) {
    process.stderr.write('CloneProof: GitHub rejected the configured token (401); retried the public preflight without it.\n');
    return;
  }
  if (source && source.preflightReason === 'http-401' && source.preflightAuthenticated === true) {
    process.stderr.write('CloneProof: GitHub rejected the configured token (401); continuing without the size check.\n');
  }
}

async function runCheck(options) {
  let resolved;
  try {
    resolved = await resolveTarget(options.target);
  } catch (error) {
    reportPreflightNotice(error);
    const report = cloneFailureReport(options.target, error, 'check');
    reportCleanupFailure(report, error.cleanupError || error);
    writeReport(report, options);
    writeReceiptForReport(report, options, null);
    return exitCodeForReport(report);
  }

  let report;
  try {
    report = applySourceTarget(
      scanRepository(resolved.path, {
        freshClone: Boolean(resolved.source),
        symlinkPaths: resolved.source ? resolved.source.symlinkPaths : [],
        repositoryName: resolved.source ? resolved.source.repo : undefined,
        requireTests: options.requireTests === true
      }),
      resolved.source
    );
    addGithubRepositorySuggestion(report, resolved.localGithubSuggestion);
    reportPreflightNotice(resolved.source);
  } finally {
    if (resolved.source) {
      try {
        await resolved.source.cleanup();
      } catch (error) {
        reportCleanupFailure(report, error);
      }
    }
  }
  writeReport(report, options);
  writeReceiptForReport(report, options, resolved);
  return exitCodeForReport(report);
}

async function runVerify(options) {
  if (!options.docker || !options.execute) {
    process.stderr.write('CloneProof: verify requires both --docker and --execute; no repository code was run.\n');
    if (options.receiptPath) process.stderr.write('CloneProof: receipt was not created because no report was produced.\n');
    return 2;
  }

  let resolved;
  try {
    resolved = await resolveTarget(options.target);
  } catch (error) {
    reportPreflightNotice(error);
    const report = cloneFailureReport(options.target, error, 'verify');
    reportCleanupFailure(report, error.cleanupError || error);
    writeReport(report, options);
    writeReceiptForReport(report, options, null);
    return exitCodeForReport(report);
  }

  let report;
  try {
    report = applySourceTarget(await verifyRepository(resolved.path, {
      execute: true,
      allowNetwork: options.allowNetwork,
      timeoutMs: options.timeoutMs,
      freshClone: Boolean(resolved.source),
      repositoryName: resolved.source ? resolved.source.repo : undefined,
      executablePaths: resolved.source ? resolved.source.executablePaths : [],
      symlinkPaths: resolved.source ? resolved.source.symlinkPaths : [],
      requireTests: options.requireTests === true
    }), resolved.source);
    addGithubRepositorySuggestion(report, resolved.localGithubSuggestion);
    reportPreflightNotice(resolved.source);
    if (report.verification && report.verification.cleanup && report.verification.cleanup.cleanupFailed) {
      reportCleanupFailure(report, report.verification.cleanup);
    }
  } finally {
    if (resolved.source) {
      try {
        await resolved.source.cleanup();
      } catch (error) {
        reportCleanupFailure(report, error);
      }
    }
  }
  writeReport(report, options);
  writeReceiptForReport(report, options, resolved);
  return exitCodeForReport(report);
}

async function runSetup() {
  const result = await setupDockerImage();
  const output = `${result.message}\n`;
  if (result.exitCode === 0) {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
  }
  return result.exitCode;
}

function runReceiptVerify(options) {
  let content;
  try {
    const stat = fs.lstatSync(options.receiptFile);
    if (!stat.isFile()) throw new Error('not a regular file');
    if (stat.size > MAX_RECEIPT_BYTES) {
      process.stderr.write(`CloneProof: receipt exceeds the ${MAX_RECEIPT_BYTES}-byte limit.\n`);
      return 2;
    }
    content = fs.readFileSync(options.receiptFile);
  } catch {
    process.stderr.write('CloneProof: the receipt file could not be read as a regular file.\n');
    return 2;
  }

  const result = verifyReceiptContent(content);
  if (result.status === 'ok') {
    process.stdout.write([
      'Receipt verified: schema v1 is valid and the SHA-256 integrity digest matches.',
      `Digest: ${result.digest}`,
      'A matching digest shows only that the content equals what was digested. It is not a signature,',
      'does not authenticate who produced the receipt, and does not certify the recorded source.',
      ''
    ].join('\n'));
    return 0;
  }
  if (result.status === 'invalid') {
    const errors = result.errors || [];
    const label = result.kind === 'digest' ? 'Receipt integrity check FAILED' : `Receipt ${result.kind} validation FAILED`;
    const lines = [`${label}: ${result.message}`];
    for (const item of errors.slice(0, 10)) lines.push(`  ${item.path || '/'}: ${item.message}`);
    if (errors.length > 10) lines.push(`  ... ${errors.length - 10} more`);
    if (result.kind === 'digest' && result.expected && result.actual) {
      lines.push(`  recorded: ${result.expected}`, `  computed: ${result.actual}`);
    }
    process.stderr.write(`${lines.join('\n')}\n`);
    return 1;
  }
  process.stderr.write(`CloneProof: ${result.message}\n`);
  return 2;
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

  if (options.version) {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  if (options.command === 'setup') {
    return runSetup();
  }

  if (options.command === 'receipt') {
    return runReceiptVerify(options);
  }

  if (options.command === 'verify') {
    return runVerify(options);
  }

  return runCheck(options);
}

if (require.main === module) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`CloneProof: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { cloneFailureReport, parseArguments, renderReport, reportCleanupFailure, reportPreflightNotice };
