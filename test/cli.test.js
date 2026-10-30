'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');
const projectRoot = path.join(__dirname, '..');
const { parseArguments, reportCleanupFailure, reportPreflightNotice } = require('../src/cli');
const { assertCoverageConsistency } = require('../src/report/coverage');

test('setup accepts no target and defaults to text output', () => {
  assert.deepEqual(parseArguments(['node', cliPath, 'setup']), {
    command: 'setup',
    target: null,
    format: 'text',
    color: undefined,
    docker: false,
    execute: false,
    allowNetwork: false,
    timeoutMs: undefined,
    outputPath: null
  });
});

test('check accepts explicit color preferences', () => {
  assert.equal(parseArguments(['node', cliPath, 'check', 'repository', '--color']).color, true);
  assert.equal(parseArguments(['node', cliPath, 'check', 'repository', '--no-color']).color, false);
});

test('version prints the package version and exits successfully', () => {
  const result = spawnSync(process.execPath, [cliPath, '--version'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(result.status, 0);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(result.stdout, `${version}\n`);
  assert.equal(result.stderr, '');
});

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

test('cleanup failure keeps the report and stderr notice limited to the folder name', () => {
  const report = { target: { kind: 'github', name: 'example/project' } };
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (value) => {
    writes.push(String(value));
    return true;
  };
  try {
    reportCleanupFailure(report, { cleanupDirectory: 'C:\\Users\\person\\AppData\\Local\\Temp\\cloneproof-github-abc123' });
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.equal(report.target.cleanupFailed, true);
  assert.deepEqual(writes, [
    'CloneProof: could not remove temporary folder cloneproof-github-abc123; it is safe to delete.\n'
  ]);
  assert.equal(writes.join('').includes('C:\\Users'), false);
});

test('configured token rejection notice contains no token value', () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (value) => {
    writes.push(String(value));
    return true;
  };
  try {
    reportPreflightNotice({ preflightReason: 'http-401', preflightAuthenticated: true });
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.deepEqual(writes, [
    'CloneProof: GitHub rejected the configured token (401); continuing without the size check.\n'
  ]);
});

test('retried token rejection notice is safe and does not require an authenticated result', () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (value) => {
    writes.push(String(value));
    return true;
  };
  try {
    reportPreflightNotice({
      preflightReason: 'checked',
      preflightAuthenticated: false,
      preflightTokenRejected: true
    });
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.deepEqual(writes, [
    'CloneProof: GitHub rejected the configured token (401); retried the public preflight without it.\n'
  ]);
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
  assert.doesNotThrow(() => assertCoverageConsistency(report.findings, report.coverage));
});

test('non-existing owner/repo paths stay local and include a GitHub suggestion', () => {
  const directory = fs.mkdtempSync(path.join(projectRoot, 'tmp-cli-github-suggestion-'));
  const owner = path.basename(directory);
  const target = path.join(owner, 'project');
  try {
    const result = spawnSync(process.execPath, [cliPath, 'check', target, '--format', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });

    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.target.kind, 'local');
    assert.equal(report.target.name, 'project');
    assert.notEqual(report.findings[0].code, 'GITHUB_URL_INVALID');
    const rootFinding = report.findings.find((finding) => finding.code === 'SCAN_ROOT_UNAVAILABLE');
    assert.ok(rootFinding);
    assert.match(rootFinding.message, new RegExp(`Did you mean https://github\\.com/${owner}/project\\?`));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('nested local paths do not guess a GitHub owner and repository from the last segments', () => {
  const directory = fs.mkdtempSync(path.join(projectRoot, 'tmp-cli-github-nested-'));
  const target = path.relative(projectRoot, path.join(directory, 'nested', 'project'));
  try {
    const result = spawnSync(process.execPath, [cliPath, 'check', target, '--format', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });

    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    const rootFinding = report.findings.find((finding) => finding.code === 'SCAN_ROOT_UNAVAILABLE');
    assert.ok(rootFinding);
    assert.doesNotMatch(rootFinding.message, /Did you mean https:\/\/github\.com\//);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GitHub-shaped relative paths remain local while suggesting the canonical root', () => {
  for (const [target, expected] of [
    ['github.com/example/project', 'example/project'],
    ['www.github.com/example/project', 'example/project'],
    ['git@github.com:example/project.git', 'example/project']
  ]) {
    const result = spawnSync(process.execPath, [cliPath, 'check', target, '--format', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });

    assert.equal(result.status, 2, target);
    const report = JSON.parse(result.stdout);
    assert.equal(report.target.kind, 'local', target);
    assert.equal(report.target.name, path.basename(target), target);
    const rootFinding = report.findings.find((finding) => finding.code === 'SCAN_ROOT_UNAVAILABLE');
    assert.ok(rootFinding, target);
    assert.match(rootFinding.message, new RegExp(`Did you mean https://github\\.com/${expected.replace('/', '\\/')}\\?`));
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
