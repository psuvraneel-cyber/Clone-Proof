const test = require('node:test');
const assert = require('node:assert/strict');
const { exitCodeForReport, renderJson, renderText } = require('../src/report/render');

function reportFixture() {
  return {
    schemaVersion: 2,
    target: { name: 'sample-repository' },
    status: 'passed_with_warnings',
    summary: { total: 4, passed: 1, failed: 1, warnings: 1, skipped: 1 },
    findings: [
      {
        status: 'passed',
        code: 'PKG-001',
        title: 'Package metadata is present',
        message: 'package.json was found.',
         evidence: [{ path: 'package.json', line: 1, detail: 'Root package manifest.' }],
        recommendation: 'Keep the package metadata committed.'
      },
      {
        status: 'failed',
        code: 'LOCK-001',
        title: 'Lockfile is missing',
        message: 'No npm lockfile was found.',
         evidence: [{ path: 'package.json', line: 12, detail: 'The required lockfile is absent.' }],
        recommendation: 'Commit package-lock.json.'
      },
      {
        status: 'warning',
        code: 'ENV-001',
        title: 'Environment configuration needs review',
        message: 'An environment variable is referenced.',
         evidence: [{ path: 'src/config.js', line: 7, detail: 'Application code reads the setting.' }],
        recommendation: 'Document the required variable.'
      },
      {
        status: 'skipped',
        code: 'DOCKER-001',
        title: 'Docker verification was skipped',
        message: 'Docker execution was not requested.',
        recommendation: 'Run verification in an explicitly enabled Docker environment.'
      }
    ]
  };
}

test('renderJson is parseable, pretty, stable, and newline terminated', () => {
  const first = { z: 1, nested: { b: true, a: 'value' }, a: [{ z: 2, a: 3 }] };
  const second = { a: [{ a: 3, z: 2 }], z: 1, nested: { a: 'value', b: true } };
  const rendered = renderJson(first);

  assert.deepEqual(JSON.parse(rendered), first);
  assert.equal(rendered, renderJson(second));
  assert.match(rendered, /^\{\n  "a":/);
  assert.equal(rendered.endsWith('\n'), true);
  assert.equal(rendered.endsWith('\n\n'), false);
});

test('renderText includes the report summary and every finding status', () => {
  const output = renderText(reportFixture(), { color: false, isTTY: true });

  assert.match(output, /CloneProof/);
  assert.match(output, /Target: sample-repository/);
  assert.match(output, /Status: passed_with_warnings/);
  assert.match(output, /Total: 4/);
  assert.match(output, /Passed: 1/);
  assert.match(output, /Failed: 1/);
  assert.match(output, /Warnings: 1/);
  assert.match(output, /Skipped: 1/);
  assert.match(output, /\[PASS\] PKG-001 — Package metadata is present/);
  assert.match(output, /\[FAIL\] LOCK-001 — Lockfile is missing/);
  assert.match(output, /\[WARN\] ENV-001 — Environment configuration needs review/);
  assert.match(output, /\[SKIP\] DOCKER-001 — Docker verification was skipped/);
  assert.match(output, /package\.json:1/);
  assert.match(output, /src\/config\.js:7 — Application code reads the setting\./);
  assert.match(output, /package\.json:1 — Root package manifest\./);
  assert.match(output, /Recommendation: Commit package-lock\.json\./);
  assert.doesNotMatch(output, /\u001b/);
});

test('renderText never emits terminal controls from report metadata', () => {
  const report = {
    target: { name: 'repo\u001b[31m\nname' },
    status: 'failed',
    findings: [{
      status: 'failed',
      code: 'BAD\u0007',
      title: 'Title\r\nwith controls',
      message: 'Message\u001b]0;owned\u0007',
      evidence: [{ path: 'src/\u001b[2J.js', line: 4 }],
      recommendation: 'Use a safe\tvalue.'
    }]
  };

  const output = renderText(report, { color: false, isTTY: true });

  assert.equal(output.includes('\u001b'), false);
  assert.equal(output.includes('\u0007'), false);
  assert.match(output, /repo\\u001b\[31m\\nname/);
  assert.match(output, /BAD\\u0007/);
  assert.match(output, /Title\\r\\nwith controls/);
  assert.match(output, /Message\\u001b\]0;owned\\u0007/);
  assert.match(output, /src\/\\u001b\[2J\.js:4/);
  assert.match(output, /safe\\tvalue/);
});

test('renderText suppresses ANSI color when output is captured or color is disabled', () => {
  const report = {
    target: { name: 'demo' },
    status: 'passed',
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 },
    findings: []
  };

  assert.doesNotMatch(renderText(report, { color: true, isTTY: false }), /\u001b\[/);
  assert.doesNotMatch(renderText(report, { color: false, isTTY: true }), /\u001b\[/);

  const previous = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '';
    assert.doesNotMatch(renderText(report, { color: true, isTTY: true }), /\u001b\[/);
  } finally {
    if (previous === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previous;
    }
  }
});

test('renderText renders bounded multiline verification output and evidence details', () => {
  const stdout = Array.from({ length: 65 }, (_, index) => `stdout-${index + 1}`).join('\n');
  const stderr = `first\n${'x'.repeat(5000)}\nlast`;
  const report = {
    schemaVersion: 2,
    target: { kind: 'local', name: 'sample-repository' },
    status: 'failed',
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    findings: [{
      status: 'failed',
      code: 'DOCKER_VERIFICATION_FAILED',
      title: 'The test script failed',
      message: 'The test workflow failed.',
      evidence: [{ path: 'verification.stderr', detail: 'Captured standard error.' }],
      recommendation: 'Review the output.'
    }],
    verification: {
      outcome: 'failed',
      image: 'node:22.19.0-bookworm-slim',
      networkMode: 'none',
      networkConsent: false,
      exitCode: 1,
      cleanup: { completed: true },
      stdout,
      stderr,
      timedOut: false,
      outputTruncated: false
    }
  };

  const output = renderText(report, { color: false, isTTY: false });

  assert.match(output, /verification\.stderr — Captured standard error\./);
  assert.doesNotMatch(output, /    stdout-1\n/);
  assert.match(output, /stdout-6/);
  assert.match(output, /stdout-65/);
  assert.doesNotMatch(output, /first/);
  assert.match(output, /last/);
  const stderrLine = output.split('  stderr:\n')[1].split('\n')[0];
  assert.ok(stderrLine.length <= 4004);
});

test('exitCodeForReport maps report statuses to the documented codes', () => {
  assert.equal(exitCodeForReport({ status: 'passed' }), 0);
  assert.equal(exitCodeForReport({ status: 'passed_with_warnings' }), 0);
  assert.equal(exitCodeForReport({ status: 'failed' }), 1);
  assert.equal(exitCodeForReport({ status: 'blocked' }), 2);
  assert.equal(exitCodeForReport({ status: 'incomplete' }), 2);
  assert.equal(exitCodeForReport({ status: 'future_status' }), 2);
  assert.equal(exitCodeForReport({}), 2);
});
