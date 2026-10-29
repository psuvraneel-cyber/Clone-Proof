'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_SUMMARY_BYTES,
  enforceSummaryByteLimit,
  escapeMarkdown,
  escapeTableCell,
  renderJobSummary,
  writeJobSummary
} = require('../src/action/summary');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 10.5 Job Summary Content Tests
// ---------------------------------------------------------------------------

test('Renders clean successful report with no non-passed findings', () => {
  const report = {
    schemaVersion: 2,
    tool: 'cloneproof',
    status: 'passed',
    summary: { total: 5, passed: 5, failed: 0, warnings: 0, skipped: 0 },
    findings: [
      { code: 'PACKAGE_JSON_PRESENT', status: 'passed', message: 'Package manifest is present' }
    ],
    coverage: {
      checked: ['package-manifest', 'lockfile-presence-validity-sync'],
      notChecked: ['build-steps-generated-output']
    }
  };

  const md = renderJobSummary(report);
  assert.match(md, /# CloneProof Repository Check/);
  assert.match(md, /\*\*Result:\*\* PASSED/);
  assert.match(md, /Total checks \| 5/);
  assert.match(md, /Passed \| 5/);
  assert.match(md, /Failed \| 0/);
  assert.match(md, /No issues or warnings detected/);
  assert.match(md, /Checks performed/);
  assert.match(md, /Package manifest/);
  assert.match(md, /Scopes not checked/);
  assert.match(md, /Running build steps/);
});

test('Renders successful report containing warnings', () => {
  const report = {
    schemaVersion: 2,
    tool: 'cloneproof',
    status: 'passed_with_warnings',
    summary: { total: 4, passed: 3, failed: 0, warnings: 1, skipped: 0 },
    findings: [
      { code: 'RUNTIME_MISMATCH', status: 'warning', message: 'Version warning', recommendation: 'Pin to node 22' }
    ]
  };

  const md = renderJobSummary(report);
  assert.match(md, /\*\*Result:\*\* PASSED WITH WARNINGS/);
  assert.match(md, /⚠️ Warning/);
  assert.match(md, /`RUNTIME_MISMATCH`/);
  assert.match(md, /Pin to node 22/);
});

test('Renders failed report with findings table and locations', () => {
  const report = {
    schemaVersion: 2,
    tool: 'cloneproof',
    status: 'failed',
    summary: { total: 2, passed: 0, failed: 1, warnings: 0, skipped: 1 },
    findings: [
      {
        code: 'TEST_SCRIPT_MISSING',
        status: 'failed',
        message: 'Missing npm test script',
        path: 'package.json',
        line: 10,
        recommendation: 'Add test script'
      },
      {
        code: 'BUILD_SKIPPED',
        status: 'skipped',
        message: 'Build output skipped'
      }
    ]
  };

  const md = renderJobSummary(report);
  assert.match(md, /\*\*Result:\*\* FAILED/);
  assert.match(md, /❌ Failed/);
  assert.match(md, /`TEST_SCRIPT_MISSING`/);
  assert.match(md, /`package.json:10`/);
  assert.match(md, /Add test script/);
  assert.match(md, /ℹ️ Skipped/);
  assert.match(md, /`BUILD_SKIPPED`/);
});

test('Renders blocked and incomplete statuses accurately', () => {
  assert.match(renderJobSummary({ status: 'blocked' }), /\*\*Result:\*\* BLOCKED/);
  assert.match(renderJobSummary({ status: 'incomplete' }), /\*\*Result:\*\* INCOMPLETE/);
});

test('Renders report with optional fields missing safely without crashing', () => {
  const emptyReport = {};
  const md = renderJobSummary(emptyReport);
  assert.match(md, /# CloneProof Repository Check/);
  assert.match(md, /\*\*Result:\*\* UNKNOWN/);
  assert.match(md, /No issues or warnings detected/);
});

test('Renders annotation truncation notice when omitted count is positive', () => {
  const report = { status: 'passed', findings: [] };
  const mdWithOmitted = renderJobSummary(report, { omittedAnnotationCount: 15 });
  assert.match(mdWithOmitted, /## Annotations/);
  assert.match(mdWithOmitted, /15 additional findings were not emitted as workflow annotations/);

  const mdWithoutOmitted = renderJobSummary(report, { omittedAnnotationCount: 0 });
  assert.doesNotMatch(mdWithoutOmitted, /## Annotations/);
});

test('Renders report location section with local runner notice', () => {
  const report = { status: 'passed' };
  const md = renderJobSummary(report, { reportPath: '/tmp/runner/report.json' });
  assert.match(md, /## Report Location/);
  assert.match(md, /Report saved to: `\/tmp\/runner\/report\.json`/);
  assert.match(md, /not automatically uploaded as GitHub workflow artifacts/);
});

// ---------------------------------------------------------------------------
// 10.6 Markdown Injection Protections
// ---------------------------------------------------------------------------

test('Adversarial Markdown content in messages and findings is neutralized', () => {
  const report = {
    status: 'failed',
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    findings: [
      {
        code: 'INJECTION_CODE',
        status: 'failed',
        message: '# Injected Heading\n| Injected | Table |\n<script>alert(1)</script>\n[Click](https://bad.example)\n`code`',
        recommendation: '![Image](https://bad.example/p.png) *emphasis* _italic_ ~strike~ #123'
      }
    ]
  };

  const md = renderJobSummary(report);

  // Injected headings must be escaped: '# Injected' -> '\# Injected'
  assert.doesNotMatch(md, /^# Injected Heading/m);
  assert.match(md, /\\# Injected Heading/);

  // Script tags must be escaped
  assert.doesNotMatch(md, /<script>/);
  assert.match(md, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  // Links and images must be escaped
  assert.doesNotMatch(md, /\[Click\]\(https:\/\/bad\.example\)/);
  assert.match(md, /\\\[Click\\\]\(https:\/\/bad\.example\)/);
  assert.doesNotMatch(md, /!\[Image\]\(https:\/\/bad\.example\/p\.png\)/);
  assert.match(md, /\\\[Image\\\]\(https:\/\/bad\.example\/p\.png\)/);

  // Table pipes and backticks must be escaped inside cells
  assert.match(md, /\\\| Injected \\\| Table \\\|/);
  assert.match(md, /\\`code\\`/);
});

test('escapeMarkdown and escapeTableCell neutralize all formatting characters', () => {
  const raw = '& < > ` * _ ~ [ ] # | \\';
  const escaped = escapeMarkdown(raw);
  assert.equal(escaped, '&amp; &lt; &gt; \\` \\* \\_ \\~ \\[ \\] \\# \\| \\\\');

  const cell = escapeTableCell('multi\r\nline\nwith | pipe');
  assert.equal(cell, 'multi line with \\| pipe');
});

// ---------------------------------------------------------------------------
// 10.7 Summary Size Limits and Multibyte Unicode Truncation
// ---------------------------------------------------------------------------

test('Small summary is untouched by byte limit', () => {
  const small = '# Header\n\nContent';
  assert.equal(enforceSummaryByteLimit(small, 512 * 1024), small);
});

test('Enforces 512 KiB limit on oversized summary without splitting multibyte Unicode', () => {
  const multiByteChar = '🚀'; // 4-byte UTF-8 character (0xF0 0x9F 0x9A 0x80)
  assert.equal(Buffer.byteLength(multiByteChar, 'utf8'), 4);

  // Construct a huge string exceeding 600 KiB filled with emojis
  const line = `Line with emoji ${multiByteChar.repeat(20)}\n`;
  const repeatCount = Math.ceil((600 * 1024) / Buffer.byteLength(line, 'utf8'));
  const hugeMarkdown = line.repeat(repeatCount);

  const truncated = enforceSummaryByteLimit(hugeMarkdown, MAX_SUMMARY_BYTES);
  const truncatedBytes = Buffer.byteLength(truncated, 'utf8');

  assert.ok(truncatedBytes <= MAX_SUMMARY_BYTES, `Byte length ${truncatedBytes} exceeds ${MAX_SUMMARY_BYTES}`);
  assert.match(truncated, /\*\*Note:\*\* Job summary truncated to stay within GitHub Actions size limits/);

  // Verify no replacement characters (\uFFFD) caused by broken Unicode byte cuts
  assert.equal(truncated.includes('\uFFFD'), false, 'Truncation must not produce corrupt Unicode replacement characters');
});

// ---------------------------------------------------------------------------
// 10.8 Summary Environment and Write Error Handling Tests
// ---------------------------------------------------------------------------

test('writeJobSummary appends Markdown when GITHUB_STEP_SUMMARY is available', () => withTempDir('cloneproof-summary-write-', (dir) => {
  const summaryFile = path.join(dir, 'summary.md');
  const result = writeJobSummary('## Test Summary\n', summaryFile);

  assert.equal(result.written, true);
  assert.equal(result.skipped, false);
  assert.equal(fs.readFileSync(summaryFile, 'utf8'), '## Test Summary\n');
}));

test('writeJobSummary skips gracefully when GITHUB_STEP_SUMMARY is missing or empty', () => {
  assert.deepEqual(writeJobSummary('content', ''), { written: false, skipped: true });
  assert.deepEqual(writeJobSummary('content', undefined), { written: false, skipped: true });
  assert.deepEqual(writeJobSummary('content', '   '), { written: false, skipped: true });
});

test('writeJobSummary catches filesystem write errors safely without throwing', () => withTempDir('cloneproof-summary-err-', (dir) => {
  const unwritableDirAsFile = path.join(dir, 'is-a-directory');
  fs.mkdirSync(unwritableDirAsFile);

  let capturedStderr = '';
  const mockStderr = {
    write: (msg) => { capturedStderr += msg; }
  };

  const result = writeJobSummary('content', unwritableDirAsFile, mockStderr);
  assert.equal(result.written, false);
  assert.equal(result.skipped, false);
  assert.ok(result.error);
  assert.match(capturedStderr, /failed to write job summary/);
}));
