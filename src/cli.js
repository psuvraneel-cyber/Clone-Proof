#!/usr/bin/env node

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

if (process.argv.includes('--help') || process.argv.length === 2) {
  printHelp();
}
