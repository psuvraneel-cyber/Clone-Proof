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
  assert.equal(Array.isArray(report.coverage.checked), true);
  assert.equal(Array.isArray(report.coverage.notChecked), true);
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
  assert.deepEqual(report.coverage.checked, []);
});

test('GitHub-shaped targets without https are rejected with a canonical URL hint', () => {
  for (const target of [
    'github.com/example/project',
    'www.github.com/example/project',
    'git@github.com:example/project.git'
  ]) {
    const result = spawnSync(process.execPath, [cliPath, 'check', target, '--format', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });

    assert.equal(result.status, 2, target);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'blocked', target);
    assert.equal(report.findings[0].code, 'GITHUB_URL_INVALID', target);
    assert.match(report.findings[0].message, /use https:\/\/github\.com\/OWNER\/REPO/);
  }
});

test('an existing local folder named like a GitHub target is still scanned as a path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-github-shaped-path-'));
  const targetDirectory = path.join(directory, 'github.com', 'example', 'project');
  fs.mkdirSync(targetDirectory, { recursive: true });
  try {
    const result = spawnSync(process.execPath, [cliPath, 'check', targetDirectory, '--format', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });

    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.notEqual(report.findings[0].code, 'GITHUB_URL_INVALID');
    assert.equal(report.findings.some((finding) => finding.code === 'EMPTY_REPOSITORY'), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
    assert.match(result.stderr, /wrote report to/);
    const html = fs.readFileSync(outputPath, 'utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /healthy-node/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('output files support text, JSON, and HTML and create missing parents', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-cli-formats-'));
  try {
    for (const [format, extension] of [['text', 'txt'], ['json', 'json'], ['html', 'html']]) {
      const outputPath = path.join(directory, 'nested', format, `report.${extension}`);
      const result = spawnSync(process.execPath, [
        cliPath,
        'check',
        path.join(projectRoot, 'examples', 'healthy-node'),
        '--format',
        format,
        '--output',
        outputPath
      ], {
        cwd: projectRoot,
        encoding: 'utf8'
      });

      assert.equal(result.status, 0, format);
      assert.equal(result.stdout, '', format);
      assert.match(result.stderr, /wrote report to/, format);
      assert.ok(result.stderr.includes(outputPath), format);
      assert.equal(fs.existsSync(outputPath), true, format);
      const contents = fs.readFileSync(outputPath, 'utf8');
      if (format === 'text') {
        assert.match(contents, /CloneProof/);
        assert.doesNotMatch(contents, /\u001b\[/);
      } else if (format === 'json') {
        assert.equal(JSON.parse(contents).tool, 'cloneproof');
      } else {
        assert.match(contents, /^<!doctype html>/i);
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
