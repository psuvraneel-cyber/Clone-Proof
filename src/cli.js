#!/usr/bin/env node

const { scanRepository } = require('./scan/repository');
const { exitCodeForReport, renderJson, renderText } = require('./report/render');

const COMMANDS = new Set(['check', 'verify']);
const FORMATS = new Set(['text', 'json']);

function printHelp() {
  process.stdout.write([
    'CloneProof — repository setup verification',
    '',
    'Usage:',
    '  cloneproof check <repository> [--format text|json]',
    '  cloneproof verify <repository> --docker --execute [--format text|json]',
    '',
    'Static check never executes repository code. Docker verification is opt-in.',
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

  return { command, target, format, color, docker, execute };
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

function run() {
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
    process.stderr.write('CloneProof: Docker verification is not enabled in this slice yet; use `check` for static inspection.\n');
    return 2;
  }

  return runCheck(options);
}

process.exitCode = run();

module.exports = { parseArguments, renderReport };
