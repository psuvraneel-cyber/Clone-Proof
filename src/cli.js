#!/usr/bin/env node

const { scanRepository } = require('./scan/repository');
const { exitCodeForReport, renderJson, renderText } = require('./report/render');
const { verifyRepository } = require('./verify/docker');

const COMMANDS = new Set(['check', 'verify']);
const FORMATS = new Set(['text', 'json']);

function printHelp() {
  process.stdout.write([
    'CloneProof — repository setup verification',
    '',
    'Usage:',
    '  cloneproof check <repository> [--format text|json]',
    '  cloneproof verify <repository> --docker --execute [--allow-network] [--timeout-ms N] [--format text|json]',
    '',
    'Static check never executes repository code. Docker verification requires explicit --docker --execute consent.',
    'Network access is disabled unless --allow-network is also provided.',
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

  return { command, target, format, color, docker, execute, allowNetwork, timeoutMs };
}

function renderReport(report, format, color) {
  return format === 'json'
    ? renderJson(report)
    : renderText(report, { color });
}

function runCheck(options) {
  const report = scanRepository(options.target);
  process.stdout.write(renderReport(report, options.format, options.color));
  return exitCodeForReport(report);
}

async function runVerify(options) {
  if (!options.docker || !options.execute) {
    process.stderr.write('CloneProof: verify requires both --docker and --execute; no repository code was run.\n');
    return 2;
  }

  const report = await verifyRepository(options.target, {
    execute: true,
    allowNetwork: options.allowNetwork,
    timeoutMs: options.timeoutMs
  });
  process.stdout.write(renderReport(report, options.format, options.color));
  return exitCodeForReport(report);
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
