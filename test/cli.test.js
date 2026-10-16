'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

test('broken fixture exits nonzero and missing paths exit incomplete', () => {
  const broken = spawnSync(process.execPath, [cliPath, 'check', path.join(projectRoot, 'examples', 'broken-node')], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  const missing = spawnSync(process.execPath, [cliPath, 'check', path.join(projectRoot, 'does-not-exist')], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /TEST_SCRIPT_MISSING/);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /Status: incomplete/);
});

test('JSON output is byte-for-byte stable across CLI runs', () => {
  const args = [cliPath, 'check', path.join(projectRoot, 'examples', 'healthy-node'), '--format', 'json'];
  const first = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'buffer' });
  const second = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'buffer' });

  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.deepEqual(second.stdout, first.stdout);
  assert.equal(JSON.parse(first.stdout.toString('utf8')).scan.complete, true);
});

test('verify refuses to run repository code without explicit authorization flags', () => {
  const result = spawnSync(process.execPath, [cliPath, 'verify', projectRoot], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires both --docker and --execute/);
});

test('invalid GitHub URLs return a blocked machine-readable report without invoking git', () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    'check',
    'https://github.com/example/project/issues',
    '--format',
    'json'
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'blocked');
  assert.equal(report.findings[0].code, 'GITHUB_URL_INVALID');
});

test('HTML reports can be written to an output file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-cli-report-'));
  const outputPath = path.join(directory, 'report.html');
  try {
    const result = spawnSync(process.execPath, [
      cliPath,
      'check',
      path.join(projectRoot, 'examples', 'healthy-node'),
      '--format',
      'html',
      '--output',
      outputPath
    ], {
      cwd: projectRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    const html = fs.readFileSync(outputPath, 'utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /healthy-node/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('output files require the HTML format', () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    'check',
    path.join(projectRoot, 'examples', 'healthy-node'),
    '--output',
    path.join(os.tmpdir(), 'cloneproof-invalid-output.json')
  ], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--output requires --format html/);
});
