'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');
const projectRoot = path.join(__dirname, '..');

test('check emits machine-readable JSON for a local repository', () => {
  const result = spawnSync(process.execPath, [cliPath, 'check', projectRoot, '--format', 'json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.tool, 'cloneproof');
  assert.equal(report.mode, 'check');
  assert.equal(report.target.kind, 'local');
  assert.equal(report.scan.complete, true);
});

test('verify refuses to run repository code until Docker execution is explicitly implemented', () => {
  const result = spawnSync(process.execPath, [cliPath, 'verify', projectRoot], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Docker verification is not enabled/);
});
