'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_ANNOTATIONS,
  MAX_ANNOTATIONS_PER_TYPE,
  MAX_TOTAL_ANNOTATIONS,
  buildAnnotations,
  compareAnnotations,
  emitAnnotations,
  extractFindingLocation,
  resolveAnnotationPath
} = require('../src/action/annotations');

const {
  escapeWorkflowMessage,
  escapeWorkflowProperty,
  formatWorkflowCommand
} = require('../src/action/workflow-commands');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 10.1 Status Mapping Tests
// ---------------------------------------------------------------------------

test('Finding status mapping to workflow commands', () => {
  const report = {
    schemaVersion: 2,
    tool: 'cloneproof',
    status: 'failed',
    findings: [
      { code: 'FAIL_1', status: 'failed', message: 'Failing check' },
      { code: 'WARN_1', status: 'warning', message: 'Warning check' },
      { code: 'SKIP_1', status: 'skipped', message: 'Skipped check' },
      { code: 'PASS_1', status: 'passed', message: 'Passed check' },
      { code: 'UNKNOWN_1', status: 'invalid_status', message: 'Unknown status check' },
      { code: 'NO_STATUS_1', message: 'Missing status' }
    ]
  };

  const { emitted, eligibleCount } = buildAnnotations(report, {
    workspaceRoot: '/mock/ws',
    targetRoot: '/mock/ws'
  });

  assert.equal(eligibleCount, 3);
  assert.equal(emitted.length, 3);

  assert.equal(emitted[0].command, 'error');
  assert.equal(emitted[0].properties.title, 'FAIL_1');

  assert.equal(emitted[1].command, 'warning');
  assert.equal(emitted[1].properties.title, 'WARN_1');

  assert.equal(emitted[2].command, 'notice');
  assert.equal(emitted[2].properties.title, 'SKIP_1');

  // Verify 'passed' and invalid statuses produced no annotations
  assert.equal(emitted.some((item) => item.properties.title === 'PASS_1'), false);
  assert.equal(emitted.some((item) => item.properties.title === 'UNKNOWN_1'), false);
  assert.equal(emitted.some((item) => item.properties.title === 'NO_STATUS_1'), false);
});

test('Findings without paths generate file-less annotations', () => {
  const report = {
    findings: [
      { code: 'WRONG_TARGET', status: 'failed', message: 'Target directory is wrong' }
    ]
  };

  const { emitted } = buildAnnotations(report, {
    workspaceRoot: '/mock/ws',
    targetRoot: '/mock/ws'
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'error');
  assert.equal(emitted[0].properties.file, undefined);
  assert.equal(emitted[0].properties.title, 'WRONG_TARGET');
  assert.equal(emitted[0].message, 'Target directory is wrong');

  const line = formatWorkflowCommand(emitted[0].command, emitted[0].properties, emitted[0].message);
  assert.equal(line, '::error title=WRONG_TARGET::Target directory is wrong');
});

test('Missing optional properties are handled safely without fabricating values', () => {
  const report = {
    findings: [
      { status: 'failed' } // no code, no message, no title, no path
    ]
  };

  const { emitted } = buildAnnotations(report);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'error');
  assert.equal(emitted[0].properties.file, undefined);
  assert.equal(emitted[0].properties.line, undefined);
  assert.equal(emitted[0].properties.col, undefined);
  assert.equal(emitted[0].properties.title, undefined);
});

test('Empty findings array produces no annotations', () => {
  const report = { findings: [] };
  const { emitted, eligibleCount } = buildAnnotations(report);
  assert.equal(eligibleCount, 0);
  assert.equal(emitted.length, 0);
});

// ---------------------------------------------------------------------------
// 10.2 Workflow Command Injection Tests
// ---------------------------------------------------------------------------

test('Adversarial finding messages cannot inject secondary workflow commands', () => {
  const injectionMessages = [
    '::error::Injected command',
    'Normal text\n::warning file=malicious.js::Injected annotation',
    'Multiple\r\n::error::CRLF injection\r\n::notice::another',
    'Percent %250A::error::Double-percent injection',
    'Colons and commas : , :: in text'
  ];

  for (const maliciousMessage of injectionMessages) {
    const formatted = formatWorkflowCommand('warning', { title: 'CODE' }, maliciousMessage);

    // Formatted line must only start with exactly one '::warning '
    assert.match(formatted, /^::warning /);
    // There must be no unescaped newlines in the command
    assert.doesNotMatch(formatted, /[\r\n]/);
    // Verify that \r, \n were encoded so secondary commands cannot be placed on a new line
    assert.doesNotMatch(formatted, /\n::/);
    assert.doesNotMatch(formatted, /\r::/);
  }
});

test('Adversarial property values cannot inject properties or secondary commands', () => {
  const badProps = {
    file: 'path/file.js,injected=true,title=OVERRIDE',
    title: 'TITLE:VALUE,EXTRA=BAD\n::error::Injected',
    line: '10\n::notice::surprise'
  };

  const formatted = formatWorkflowCommand('error', badProps, 'Ordinary message');

  // Verify commas, colons, newlines in properties were safely escaped
  assert.match(formatted, /^::error /);
  assert.doesNotMatch(formatted, /[\r\n]/);
  assert.match(formatted, /%2C/);
  assert.match(formatted, /%3A/);
  assert.match(formatted, /%0A/);
});

test('Workflow property and message escaping order preserves percents correctly', () => {
  // Percent escaping must occur first: '%25' should become '%2525', not double-expand later
  assert.equal(escapeWorkflowProperty('%'), '%25');
  assert.equal(escapeWorkflowProperty('%25'), '%2525');
  assert.equal(escapeWorkflowProperty('hello%world:1,2\r\n'), 'hello%25world%3A1%2C2%0D%0A');

  assert.equal(escapeWorkflowMessage('%'), '%25');
  assert.equal(escapeWorkflowMessage('%25'), '%2525');
  assert.equal(escapeWorkflowMessage('line1\r\nline2%3A'), 'line1%0D%0Aline2%253A');
});

// ---------------------------------------------------------------------------
// 10.3 Path Resolution Tests
// ---------------------------------------------------------------------------

test('Safe workspace-relative path resolution', () => withTempDir('cloneproof-path-test-', (workspace) => {
  const backendDir = path.join(workspace, 'packages', 'backend');
  const webDir = path.join(workspace, 'apps', 'web');
  fs.mkdirSync(backendDir, { recursive: true });
  fs.mkdirSync(webDir, { recursive: true });

  // Specification table:
  // | Target path | Finding path | Expected annotation path |
  // | . | src/index.js | src/index.js |
  // | packages/backend | src/server.js | packages/backend/src/server.js |
  // | apps/web | src/App.js | apps/web/src/App.js |
  // | packages/backend | . | packages/backend |

  assert.equal(
    resolveAnnotationPath('src/index.js', workspace, workspace),
    'src/index.js'
  );

  assert.equal(
    resolveAnnotationPath('src/server.js', workspace, backendDir),
    'packages/backend/src/server.js'
  );

  assert.equal(
    resolveAnnotationPath('src/App.js', workspace, webDir),
    'apps/web/src/App.js'
  );

  assert.equal(
    resolveAnnotationPath('.', workspace, backendDir),
    'packages/backend'
  );

  // Windows-style separators normalize to forward slashes
  assert.equal(
    resolveAnnotationPath('src\\deep\\file.js', workspace, backendDir),
    'packages/backend/src/deep/file.js'
  );

  // Unicode and spaces
  assert.equal(
    resolveAnnotationPath('src/folder with spaces/üñîçødë.js', workspace, workspace),
    'src/folder with spaces/üñîçødë.js'
  );
}));

test('Unsafe and escaping paths are rejected and omitted from annotations', () => withTempDir('cloneproof-unsafe-path-test-', (workspace) => {
  const backendDir = path.join(workspace, 'packages', 'backend');
  fs.mkdirSync(backendDir, { recursive: true });

  // Path traversal beyond targetRoot
  assert.equal(resolveAnnotationPath('../../outside.js', workspace, backendDir), null);
  assert.equal(resolveAnnotationPath('../../../etc/passwd', workspace, workspace), null);

  // Absolute POSIX paths
  assert.equal(resolveAnnotationPath('/etc/passwd', workspace, workspace), null);
  assert.equal(resolveAnnotationPath('/var/log/syslog', workspace, backendDir), null);

  // Windows drive-prefixed paths and UNC paths
  assert.equal(resolveAnnotationPath('C:\\Windows\\System32', workspace, workspace), null);
  assert.equal(resolveAnnotationPath('D:/repo/file.js', workspace, workspace), null);
  assert.equal(resolveAnnotationPath('\\\\server\\share\\file.js', workspace, workspace), null);
  assert.equal(resolveAnnotationPath('//server/share/file.js', workspace, workspace), null);

  // Finding with unsafe path still emits file-less annotation
  const report = {
    findings: [
      {
        code: 'UNSAFE_PATH_FINDING',
        status: 'failed',
        path: '../../escape.js',
        message: 'Problem detected'
      }
    ]
  };

  const { emitted } = buildAnnotations(report, {
    workspaceRoot: workspace,
    targetRoot: backendDir
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].properties.file, undefined, 'Unsafe path must not be emitted');
  assert.equal(emitted[0].properties.title, 'UNSAFE_PATH_FINDING');
}));

// ---------------------------------------------------------------------------
// 10.4 Annotation Limits and Deterministic Ordering Tests
// ---------------------------------------------------------------------------

test('Enforces 10 errors, 10 warnings, 10 notices limit (max 30 total) with priority order', () => {
  assert.equal(MAX_ANNOTATIONS_PER_TYPE, 10);
  assert.equal(MAX_TOTAL_ANNOTATIONS, 30);

  const findings = [];
  // 15 skipped findings
  for (let i = 0; i < 15; i += 1) {
    findings.push({ code: `SKIP_${String(i).padStart(2, '0')}`, status: 'skipped', message: `Skipped ${i}` });
  }
  // 15 warning findings
  for (let i = 0; i < 15; i += 1) {
    findings.push({ code: `WARN_${String(i).padStart(2, '0')}`, status: 'warning', message: `Warning ${i}` });
  }
  // 15 failed findings
  for (let i = 0; i < 15; i += 1) {
    findings.push({ code: `FAIL_${String(i).padStart(2, '0')}`, status: 'failed', message: `Failed ${i}` });
  }

  const report = { findings };
  const { emitted, eligibleCount, omittedCount } = buildAnnotations(report);

  assert.equal(eligibleCount, 45);
  assert.equal(emitted.length, 30);
  assert.equal(omittedCount, 15);

  // Exactly 10 failures (errors)
  const failedEmitted = emitted.filter((item) => item.command === 'error');
  assert.equal(failedEmitted.length, 10);

  // Exactly 10 warnings
  const warningEmitted = emitted.filter((item) => item.command === 'warning');
  assert.equal(warningEmitted.length, 10);

  // Exactly 10 skipped (notices)
  const skippedEmitted = emitted.filter((item) => item.command === 'notice');
  assert.equal(skippedEmitted.length, 10);

  // Severity order preserved: all errors first, then warnings, then notices
  for (let i = 0; i < 10; i += 1) assert.equal(emitted[i].command, 'error');
  for (let i = 10; i < 20; i += 1) assert.equal(emitted[i].command, 'warning');
  for (let i = 20; i < 30; i += 1) assert.equal(emitted[i].command, 'notice');

  // Underlying report array must be completely untouched
  assert.equal(report.findings.length, 45);
});

test('Enforces per-type cap on 11 error findings', () => {
  const findings = [];
  for (let i = 0; i < 11; i += 1) {
    findings.push({ code: `FAIL_${i}`, status: 'failed', message: `Failure ${i}` });
  }
  const { emitted, eligibleCount, omittedCount } = buildAnnotations({ findings });
  assert.equal(eligibleCount, 11);
  assert.equal(emitted.length, 10);
  assert.equal(omittedCount, 1);
  assert.equal(emitted.every((item) => item.command === 'error'), true);
});

test('Enforces per-type cap on 11 warning findings', () => {
  const findings = [];
  for (let i = 0; i < 11; i += 1) {
    findings.push({ code: `WARN_${i}`, status: 'warning', message: `Warning ${i}` });
  }
  const { emitted, eligibleCount, omittedCount } = buildAnnotations({ findings });
  assert.equal(eligibleCount, 11);
  assert.equal(emitted.length, 10);
  assert.equal(omittedCount, 1);
  assert.equal(emitted.every((item) => item.command === 'warning'), true);
});

test('Enforces per-type cap on 11 skipped findings', () => {
  const findings = [];
  for (let i = 0; i < 11; i += 1) {
    findings.push({ code: `SKIP_${i}`, status: 'skipped', message: `Skipped ${i}` });
  }
  const { emitted, eligibleCount, omittedCount } = buildAnnotations({ findings });
  assert.equal(eligibleCount, 11);
  assert.equal(emitted.length, 10);
  assert.equal(omittedCount, 1);
  assert.equal(emitted.every((item) => item.command === 'notice'), true);
});

test('Deterministic ordering between repeated runs and tie-breaking', () => {
  const findings = [
    { code: 'B_WARN', status: 'warning', path: 'src/b.js', line: 10, message: 'msg B' },
    { code: 'A_WARN', status: 'warning', path: 'src/a.js', line: 5, message: 'msg A' },
    { code: 'A_WARN_2', status: 'warning', path: 'src/a.js', line: 20, message: 'msg A2' },
    { code: 'C_FAIL', status: 'failed', path: 'src/z.js', line: 1, message: 'msg C' },
    { code: 'D_FAIL', status: 'failed', path: 'src/a.js', line: 1, message: 'msg D' }
  ];

  const report = { findings };

  const run1 = buildAnnotations(report, { workspaceRoot: '/ws', targetRoot: '/ws' });
  const run2 = buildAnnotations(report, { workspaceRoot: '/ws', targetRoot: '/ws' });

  assert.deepEqual(run1.emitted, run2.emitted, 'Annotation ordering must be completely deterministic');

  // Verify priority order:
  // First failed findings (D_FAIL at src/a.js, then C_FAIL at src/z.js)
  assert.equal(run1.emitted[0].properties.title, 'D_FAIL');
  assert.equal(run1.emitted[1].properties.title, 'C_FAIL');

  // Then warning findings (A_WARN at src/a.js:5, A_WARN_2 at src/a.js:20, B_WARN at src/b.js:10)
  assert.equal(run1.emitted[2].properties.title, 'A_WARN');
  assert.equal(run1.emitted[3].properties.title, 'A_WARN_2');
  assert.equal(run1.emitted[4].properties.title, 'B_WARN');
});

test('emitAnnotations writes workflow lines and does NOT emit truncation notice command', () => {
  const findings = [];
  for (let i = 0; i < 25; i += 1) {
    findings.push({ code: `ERR_${i}`, status: 'failed', message: `Failure ${i}` });
  }

  let output = '';
  const mockDest = {
    write: (text) => { output += text; }
  };

  const result = emitAnnotations({ findings }, { destination: mockDest });

  assert.equal(result.eligibleCount, 25);
  assert.equal(result.emittedCount, 10);
  assert.equal(result.omittedCount, 15);

  const lines = output.trim().split('\n');
  // Exactly 10 error lines, NO extra notice command consuming quota
  assert.equal(lines.length, 10);
  assert.equal(lines.every((l) => l.startsWith('::error ')), true);
  assert.equal(output.includes('::notice'), false, 'Must not emit ::notice solely to announce truncation');
});
