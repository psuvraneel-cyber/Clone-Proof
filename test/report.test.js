const test = require('node:test');
const assert = require('node:assert/strict');
const { exitCodeForReport, renderHtml, renderJson, renderText } = require('../src/report/render');
const { CHECK_GROUPS, NOT_CHECKED } = require('../src/report/coverage');

const ALL_CHECK_GROUPS = Object.freeze(Object.values(CHECK_GROUPS));

function reportFixture() {
  return {
    schemaVersion: 2,
    mode: 'check',
    target: { name: 'sample-repository' },
    status: 'passed_with_warnings',
    coverage: { checked: ALL_CHECK_GROUPS, notChecked: NOT_CHECKED },
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

test('renderJson preserves schema-v2 report coverage', () => {
  const report = reportFixture();
  const rendered = renderJson(report);

  assert.deepEqual(JSON.parse(rendered).coverage, {
    checked: ALL_CHECK_GROUPS,
    notChecked: NOT_CHECKED
  });
});

test('renderText explains a passed static check and renders coverage sections', () => {
  const report = {
    schemaVersion: 2,
    mode: 'check',
    target: { kind: 'local', name: 'healthy-repository' },
    status: 'passed',
    coverage: { checked: ALL_CHECK_GROUPS.slice(0, 12), notChecked: NOT_CHECKED },
    findings: Array.from({ length: 6 }, (_, index) => ({
      status: 'passed',
      code: `CHECK-${index + 1}`,
      title: `Check group ${index + 1} passed`,
      message: 'No setup problem was found.'
    })),
    summary: { total: 6, passed: 6, failed: 0, warnings: 0, skipped: 0 }
  };

  const output = renderText(report, { color: false, isTTY: false });
  const html = renderHtml(report);

  assert.match(output, /Status: passed\nNo known setup problems were found across 12 check groups \(6 findings\)\. This is not a guarantee that a fresh clone works; see Not checked\./);
  assert.match(output, /Finding counts:\n  Total: 6/);
  assert.equal((output.match(/^Findings:$/gm) || []).length, 1);
  assert.equal((output.match(/^Finding counts:$/gm) || []).length, 1);
  assert.match(output, /What was checked:/);
  assert.match(output, /Package manifest \(package-manifest\)/);
  assert.match(output, /Not checked:/);
  assert.match(output, /Running build steps \(declared outputs are only checked for presence\) \(build-steps-generated-output\)/);
  assert.match(html, /No known setup problems were found across 12 check groups \(6 findings\)\. This is not a guarantee that a fresh clone works; see Not checked\./);
  assert.match(html, /<h3 id="counts-heading">Finding counts<\/h3>/);
  assert.equal((html.match(/<h3 id="counts-heading">Finding counts<\/h3>/g) || []).length, 1);
  assert.equal((html.match(/<h2 id="findings-heading">Findings /g) || []).length, 1);
  assert.match(html, /What was checked/);
  assert.match(html, /Not checked/);
});

test('renderText and renderHtml explain a passed Docker verification', () => {
  const report = {
    schemaVersion: 2,
    mode: 'verify',
    target: { kind: 'local', name: 'healthy-repository' },
    status: 'passed',
    coverage: { checked: ALL_CHECK_GROUPS, notChecked: NOT_CHECKED },
    findings: [],
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 },
    verification: {
      outcome: 'passed',
      networkMode: 'none',
      networkConsent: false,
      exitCode: 0,
      cleanup: { completed: true }
    }
  };

  const text = renderText(report, { color: false, isTTY: false });
  const html = renderHtml(report);
  const explanation = 'npm ci and npm test succeeded inside the controlled container.';

  assert.equal((text.match(/^Findings:$/gm) || []).length, 1);
  assert.equal((text.match(/^Finding counts:$/gm) || []).length, 1);
  assert.equal((html.match(/<h3 id="counts-heading">Finding counts<\/h3>/g) || []).length, 1);
  assert.equal((html.match(/<h2 id="findings-heading">Findings /g) || []).length, 1);
  assert.match(text, new RegExp(`Status: passed\\n${explanation.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`));
  assert.match(html, new RegExp(explanation.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  assert.match(html, /What was checked/);
  assert.match(html, /Not checked/);
  assert.match(html, /Package manifest/);
  assert.match(html, /Running build steps \(declared outputs are only checked for presence\)/);
});

test('renderText and renderHtml do not claim success when no tests ran', () => {
  const report = {
    schemaVersion: 2,
    mode: 'verify',
    target: { kind: 'local', name: 'empty-test-repository' },
    status: 'failed',
    coverage: { checked: ALL_CHECK_GROUPS, notChecked: NOT_CHECKED },
    findings: [{
      code: 'VERIFY_NO_TESTS_RAN',
      status: 'failed',
      severity: 'error',
      title: 'npm test exited 0, but no tests ran; this verification proves nothing about the test suite.',
      message: 'npm test exited 0, but no tests ran; this verification proves nothing about the test suite.',
      evidence: [{ path: 'verification.stdout', detail: 'Matched zero-test line: Test Files 0 passed (0)' }],
      recommendation: 'Add or select at least one test.'
    }],
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    verification: {
      outcome: 'failed',
      noTestsRan: true,
      networkMode: 'none',
      networkConsent: false,
      exitCode: 0,
      cleanup: { completed: true },
      stdout: 'Test Files 0 passed (0)\n',
      stderr: ''
    }
  };

  const text = renderText(report, { color: false, isTTY: false });
  const html = renderHtml(report);
  const headline = 'npm test exited 0, but no tests ran; this verification proves nothing about the test suite.';

  assert.match(text, /VERIFY_NO_TESTS_RAN/);
  assert.match(text, new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /Tests detected: no/);
  assert.doesNotMatch(text, /npm ci and npm test succeeded/);
  assert.match(html, /VERIFY_NO_TESTS_RAN/);
  assert.match(html, new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Tests detected.*no/);
  assert.doesNotMatch(html, /npm ci and npm test succeeded/);
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

test('render headers show only the first 12 characters of a Git commit', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const report = {
    target: { kind: 'github', name: 'example/project', commit },
    status: 'passed',
    findings: []
  };

  const text = renderText(report, { color: false, isTTY: false });
  const html = renderHtml(report);

  assert.match(text, /^Commit: 0123456789ab$/m);
  assert.doesNotMatch(text, new RegExp(commit));
  assert.match(html, /<strong>Commit:<\/strong> 0123456789ab/);
  assert.doesNotMatch(html, new RegExp(commit));
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

function withNoColor(value, callback) {
  const previous = process.env.NO_COLOR;
  try {
    if (value === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = value;
    }
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previous;
    }
  }
}

test('renderText color follows the TTY when no preference is given', () => {
  const report = {
    target: { name: 'demo' },
    status: 'passed',
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 },
    findings: []
  };

  withNoColor(undefined, () => {
    assert.match(renderText(report, { isTTY: true }), /\u001b\[/);
    assert.doesNotMatch(renderText(report, { isTTY: false }), /\u001b\[/);
  });
});

test('renderText honors --color and --no-color over the TTY', () => {
  const report = {
    target: { name: 'demo' },
    status: 'passed',
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 },
    findings: []
  };

  withNoColor(undefined, () => {
    assert.match(renderText(report, { color: true, isTTY: false }), /\u001b\[/);
    assert.doesNotMatch(renderText(report, { color: false, isTTY: true }), /\u001b\[/);
  });
});

test('renderText lets NO_COLOR disable color unless --color is passed', () => {
  const report = {
    target: { name: 'demo' },
    status: 'passed',
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 },
    findings: []
  };

  withNoColor('', () => {
    assert.doesNotMatch(renderText(report, { isTTY: true }), /\u001b\[/);
    assert.match(renderText(report, { color: true, isTTY: true }), /\u001b\[/);
    assert.match(renderText(report, { color: true, isTTY: false }), /\u001b\[/);
    assert.doesNotMatch(renderText(report, { color: false, isTTY: true }), /\u001b\[/);
  });
});

test('renderHtml escapes untrusted report values', () => {
  const report = {
    schemaVersion: 2,
    target: { kind: 'local', name: '<img src=x onerror="alert(\'target\')"> & target' },
    status: 'failed<script>alert(\'status\')</script>',
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    findings: [{
      status: 'failed',
      code: '<code>&',
      title: '<script>alert("title")</script>',
      message: 'Message with </p> and "quotes".',
      evidence: [{ path: 'src/<unsafe>.js', line: 7, detail: 'Detail & more' }],
      recommendation: 'Use <strong>safe</strong> output.'
    }],
    verification: {
      outcome: 'failed',
      networkMode: 'none',
      networkConsent: false,
      exitCode: 1,
      cleanup: { completed: true },
      stdout: '<script>stdout</script>',
      stderr: 'stderr & more'
    }
  };

  const output = renderHtml(report);

  assert.doesNotMatch(output, /<img\b/i);
  assert.doesNotMatch(output, /<script\b/i);
  assert.match(output, /&lt;img src=x onerror=&quot;alert\(&#39;target&#39;\)&quot;&gt; &amp; target/);
  assert.match(output, /&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/);
  assert.match(output, /src\/&lt;unsafe&gt;\.js:7/);
  assert.match(output, /Detail &amp; more/);
  assert.match(output, /Use &lt;strong&gt;safe&lt;\/strong&gt; output\./);
  assert.match(output, /&lt;script&gt;stdout&lt;\/script&gt;/);
});

test('renderHtml is self-contained and includes the accessible report sections', () => {
  const report = reportFixture();
  report.verification = {
    outcome: 'passed',
    image: 'node:22.19.0-bookworm-slim',
    networkMode: 'none',
    networkConsent: false,
    exitCode: 0,
    cleanup: { attempted: true, completed: true },
    stdout: 'verification passed',
    stderr: ''
  };

  const output = renderHtml(report);

  assert.match(output, /^<!doctype html>/i);
  assert.match(output, /<html lang="en">/);
  assert.match(output, /<main>/);
  assert.match(output, /Target:.*sample-repository/);
  assert.match(output, /Summary/);
  assert.match(output, /Status:.*passed_with_warnings/);
  assert.match(output, /<h3 id="counts-heading">Finding counts<\/h3>/);
  assert.match(output, /Total.*4/);
  assert.match(output, /Findings/);
  assert.match(output, /PKG-001/);
  assert.match(output, /package\.json:1/);
  assert.match(output, /Root package manifest\./);
  assert.match(output, /Recommendation/);
  assert.match(output, /Commit package-lock\.json\./);
  assert.match(output, /Docker verification/);
  assert.match(output, /Outcome.*passed/);
  assert.match(output, /Network.*none/);
  assert.match(output, /Exit code.*0/);
  assert.match(output, /Cleanup complete.*yes/);
  assert.match(output, /stdout/);
  assert.match(output, /stderr/);

  assert.doesNotMatch(output, /<(?:script|link)\b/i);
  assert.doesNotMatch(output, /\b(?:src|href)\s*=/i);
  assert.doesNotMatch(output, /\burl\s*\(/i);
  assert.doesNotMatch(output, /https?:\/\//i);
  assert.doesNotMatch(output, /role="status"/);
});

test('renderHtml bounds multiline verification output like renderText', () => {
  const stdout = Array.from({ length: 65 }, (_, index) => `stdout-${index + 1}`).join('\n');
  const stderr = `first\n${'x'.repeat(5000)}\nlast`;
  const report = {
    schemaVersion: 2,
    target: { kind: 'local', name: 'sample-repository' },
    status: 'failed',
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    findings: [],
    verification: {
      outcome: 'failed',
      networkMode: 'none',
      networkConsent: false,
      exitCode: 1,
      cleanup: { completed: true },
      stdout,
      stderr
    }
  };

  const output = renderHtml(report);
  const stdoutMatch = output.match(/<pre data-stream="stdout"[^>]*><code>([\s\S]*?)<\/code><\/pre>/);
  const stderrMatch = output.match(/<pre data-stream="stderr"[^>]*><code>([\s\S]*?)<\/code><\/pre>/);

  assert.ok(stdoutMatch);
  assert.ok(stderrMatch);
  assert.equal(stdoutMatch[1].split('\n').length, 61);
  assert.match(stdoutMatch[1], /^\.\.\. 5 earlier lines omitted\nstdout-6\n/);
  assert.match(stdoutMatch[1], /stdout-65$/);
  assert.doesNotMatch(stdoutMatch[1], /stdout-[1-5](?:\n|$)/);
  assert.match(stderrMatch[1], /^\.\.\. shortened to the last 4,000 characters\n/);
  assert.ok(stderrMatch[1].length > 4000);
  assert.match(stderrMatch[1], /last$/);
  assert.doesNotMatch(stderrMatch[1], /first/);
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
  assert.match(output, /\.\.\. 5 earlier lines omitted/);
  assert.match(output, /stdout-6/);
  assert.match(output, /stdout-65/);
  assert.doesNotMatch(output, /first/);
  assert.match(output, /\.\.\. shortened to the last 4,000 characters/);
  assert.match(output, /last/);
  const stderrLine = output.split('  stderr:\n')[1].split('\n')[0];
  assert.ok(stderrLine.length <= 4004);
});

test('renderText and renderHtml cap finding evidence at ten items', () => {
  const report = {
    target: { kind: 'local', name: 'evidence-fixture' },
    status: 'passed_with_warnings',
    findings: [{
      status: 'warning',
      code: 'EVIDENCE_CAP',
      title: 'Evidence is bounded',
      message: 'Many evidence items are present.',
      evidence: Array.from({ length: 30 }, (_, index) => ({
        path: `evidence-${String(index + 1).padStart(2, '0')}.txt`,
        detail: 'Evidence item.'
      })),
      recommendation: 'Use JSON for the complete evidence list.'
    }]
  };

  const text = renderText(report, { color: false, isTTY: false });
  const html = renderHtml(report);

  assert.equal((text.match(/evidence-\d+\.txt/g) || []).length, 10);
  assert.match(text, /… and 20 more \(see --format json\)/);
  assert.equal((html.match(/evidence-\d+\.txt/g) || []).length, 10);
  assert.match(html, /… and 20 more \(see --format json\)/);
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
