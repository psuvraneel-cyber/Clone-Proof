'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const actionScriptPath = path.join(projectRoot, 'src', 'action', 'index.js');
const actionYmlPath = path.join(projectRoot, 'action.yml');

const {
  ALLOWED_VERIFY_EVENTS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  MAX_VERIFY_TIMEOUT_MS,
  exportOutput,
  filterChildEnvironment,
  getActionInput,
  isAllowedVerifyEvent,
  isLinuxRunner,
  isSubPath,
  normalizePathForComparison,
  pipeSanitizedOutput,
  readAndValidateReport,
  resolveCliEntrypoint,
  runAction,
  sanitizeWorkflowCommandText,
  spawnAndCapture,
  validateAllowNetwork,
  validateMode,
  validateReportPath,
  validateReportStructure,
  validateRequiredEnvironment,
  validateTargetPath,
  validateTimeoutMs
} = require('../src/action/index');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Correct action metadata in action.yml', () => {
  assert.equal(fs.existsSync(actionYmlPath), true, 'action.yml must exist at the repository root');
  const content = fs.readFileSync(actionYmlPath, 'utf8');

  assert.match(content, /^name:\s*['"]?CloneProof['"]?/m);
  assert.match(content, /using:\s*['"]?node24['"]?/);
  assert.match(content, /main:\s*['"]?src\/action\/index\.js['"]?/);

  assert.match(content, /inputs:\s*\n[\s\S]*target-path:/);
  assert.match(content, /default:\s*['"]?\.['"]?/);
  assert.match(content, /inputs:\s*\n[\s\S]*report-path:/);
  assert.match(content, /inputs:\s*\n[\s\S]*mode:/);
  assert.match(content, /inputs:\s*\n[\s\S]*allow-network:/);
  assert.match(content, /inputs:\s*\n[\s\S]*timeout-ms:/);

  assert.match(content, /outputs:\s*\n[\s\S]*status:/);
  assert.match(content, /outputs:\s*\n[\s\S]*report-path:/);
  assert.match(content, /outputs:\s*\n[\s\S]*verification-status:/);
});

test('Valid workspace detection', () => withTempDir('cloneproof-action-ws-', (dir) => {
  const outputFilePath = path.join(dir, 'output.txt');
  const tempPath = path.join(dir, 'temp');
  fs.mkdirSync(tempPath, { recursive: true });

  const validEnv = {
    GITHUB_WORKSPACE: dir,
    GITHUB_OUTPUT: outputFilePath,
    RUNNER_TEMP: tempPath
  };

  assert.doesNotThrow(() => validateRequiredEnvironment(validEnv, ''));
}));

test('Missing workspace throws descriptive error', () => withTempDir('cloneproof-action-missing-ws-', (dir) => {
  const outputFilePath = path.join(dir, 'output.txt');
  const tempPath = path.join(dir, 'temp');

  assert.throws(
    () => validateRequiredEnvironment({ GITHUB_OUTPUT: outputFilePath, RUNNER_TEMP: tempPath }),
    /GITHUB_WORKSPACE environment variable is missing or empty/
  );

  assert.throws(
    () => validateRequiredEnvironment({ GITHUB_WORKSPACE: '   ', GITHUB_OUTPUT: outputFilePath, RUNNER_TEMP: tempPath }),
    /GITHUB_WORKSPACE environment variable is missing or empty/
  );

  assert.throws(
    () => validateRequiredEnvironment({ GITHUB_WORKSPACE: dir, RUNNER_TEMP: tempPath }),
    /GITHUB_OUTPUT environment variable is missing or empty/
  );

  assert.throws(
    () => validateRequiredEnvironment({ GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: outputFilePath, RUNNER_TEMP: '' }, ''),
    /RUNNER_TEMP environment variable is missing or empty/
  );
}));

test('Invalid target path is rejected', () => withTempDir('cloneproof-action-target-', (dir) => {
  assert.throws(
    () => validateTargetPath('non-existent-subfolder', dir),
    /Target directory does not exist/
  );

  const regularFile = path.join(dir, 'file.txt');
  fs.writeFileSync(regularFile, 'hello');
  assert.throws(
    () => validateTargetPath('file.txt', dir),
    /Target path must be a directory/
  );
}));

test('Path traversal in target path is rejected', () => withTempDir('cloneproof-action-traversal-', (dir) => {
  assert.throws(
    () => validateTargetPath('../outside', dir),
    /resolves outside GITHUB_WORKSPACE/
  );

  assert.throws(
    () => validateTargetPath('../../etc/passwd', dir),
    /resolves outside GITHUB_WORKSPACE/
  );

  const outsidePath = path.resolve(dir, '..');
  assert.throws(
    () => validateTargetPath(outsidePath, dir),
    /resolves outside GITHUB_WORKSPACE/
  );
}));

test('Symlink escaping workspace in target path is rejected', (t) => withTempDir('cloneproof-action-symlink-', (dir) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-outside-ws-'));
  const linkPath = path.join(dir, 'symlink-target');
  try {
    try {
      fs.symlinkSync(outsideDir, linkPath, 'dir');
    } catch (symlinkErr) {
      t.skip(`symlinks are unavailable: ${symlinkErr.code || symlinkErr.message}`);
      return;
    }
    assert.throws(
      () => validateTargetPath('symlink-target', dir),
      /points outside GITHUB_WORKSPACE via symlink/
    );
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
}));

test('Invalid report destination is rejected', () => withTempDir('cloneproof-action-report-dest-', (dir) => {
  const runnerTemp = path.join(dir, 'runner-temp');
  fs.mkdirSync(runnerTemp, { recursive: true });

  assert.throws(
    () => validateReportPath('../../outside/report.json', dir, runnerTemp, dir),
    /must resolve inside GITHUB_WORKSPACE or RUNNER_TEMP/
  );

  assert.throws(
    () => validateReportPath(dir, dir, runnerTemp, dir),
    /is a directory, expected a file path/
  );

  const insideWorkspace = validateReportPath('reports/report.json', dir, runnerTemp, dir);
  assert.equal(isSubPath(dir, insideWorkspace), true);

  const insideRunnerTemp = validateReportPath(path.join(runnerTemp, 'report.json'), dir, runnerTemp, dir);
  assert.equal(isSubPath(runnerTemp, insideRunnerTemp), true);
}));

test('Symlink escaping allowed directories in report destination is rejected', (t) => withTempDir('cloneproof-action-report-symlink-', (dir) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-report-outside-'));
  const linkDir = path.join(dir, 'symlinked-folder');
  try {
    try {
      fs.symlinkSync(outsideDir, linkDir, 'dir');
    } catch (symlinkErr) {
      t.skip(`symlinks are unavailable: ${symlinkErr.code || symlinkErr.message}`);
      return;
    }
    assert.throws(
      () => validateReportPath(path.join(linkDir, 'report.json'), dir, dir, dir),
      /resolves outside allowed directories/
    );
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
}));

test('Successful CLI execution on healthy fixture', async () => withTempDirAsync('cloneproof-action-healthy-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const healthyFixture = path.join(projectRoot, 'examples', 'healthy-node');

  const env = {
    GITHUB_WORKSPACE: projectRoot,
    'INPUT_TARGET-PATH': healthyFixture,
    GITHUB_OUTPUT: githubOutput,
    RUNNER_TEMP: runnerTemp,
    NO_COLOR: '1'
  };

  const exitCode = await runAction({ env });
  assert.equal(exitCode, 0);

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=passed$/m);
  assert.match(outputContent, /^report-path=.+report\.json$/m);
  assert.match(outputContent, /^verification-status=not_run$/m);

  const match = outputContent.match(/^report-path=(.+)$/m);
  assert.ok(match, 'report-path output must be present');
  const reportPath = match[1].trim();

  assert.equal(fs.existsSync(reportPath), true, 'Report file must exist');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.tool, 'cloneproof');
  assert.equal(report.status, 'passed');
  assert.equal(report.findings.some((f) => f.status === 'failed'), false);
}));

test('Failed CLI execution on broken fixture preserves report and returns code 1', async () => withTempDirAsync('cloneproof-action-broken-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const brokenFixture = path.join(projectRoot, 'examples', 'broken-node');

  const env = {
    GITHUB_WORKSPACE: projectRoot,
    'INPUT_TARGET-PATH': brokenFixture,
    GITHUB_OUTPUT: githubOutput,
    RUNNER_TEMP: runnerTemp,
    NO_COLOR: '1'
  };

  const exitCode = await runAction({ env });
  assert.equal(exitCode, 1, 'Action must preserve CLI exit code 1 on failure');

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=failed$/m);

  const match = outputContent.match(/^report-path=(.+)$/m);
  assert.ok(match);
  const reportPath = match[1].trim();

  assert.equal(fs.existsSync(reportPath), true, 'Report file must be preserved on failure');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.status, 'failed');
  assert.ok(report.findings.some((f) => f.code === 'TEST_SCRIPT_MISSING' && f.status === 'failed'));
}));

test('Blocked CLI execution preserves report and returns code 2', async () => withTempDirAsync('cloneproof-action-blocked-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const emptyTarget = path.join(dir, 'empty-repo');
  fs.mkdirSync(runnerTemp, { recursive: true });
  fs.mkdirSync(emptyTarget, { recursive: true });

  const env = {
    GITHUB_WORKSPACE: dir,
    'INPUT_TARGET-PATH': emptyTarget,
    GITHUB_OUTPUT: githubOutput,
    RUNNER_TEMP: runnerTemp,
    NO_COLOR: '1'
  };

  const exitCode = await runAction({ env });
  assert.equal(exitCode, 2, 'Action must preserve CLI exit code 2 on blocked execution');

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=blocked$/m);

  const match = outputContent.match(/^report-path=(.+)$/m);
  assert.ok(match);
  const reportPath = match[1].trim();
  assert.equal(fs.existsSync(reportPath), true, 'Report file must be preserved');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'blocked');
}));

test('Malformed JSON report is detected and rejected', async () => withTempDirAsync('cloneproof-action-malformed-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const targetDir = path.join(dir, 'repo');
  fs.mkdirSync(runnerTemp, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const customReportPath = path.join(dir, 'corrupt-report.json');

  const mockSpawn = () => {
    fs.writeFileSync(customReportPath, '{ not valid json : [ }');
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        if (event === 'close') setTimeout(() => handler(0, null), 10);
      }
    };
  };

  const env = {
    GITHUB_WORKSPACE: dir,
    'INPUT_TARGET-PATH': targetDir,
    'INPUT_REPORT-PATH': customReportPath,
    GITHUB_OUTPUT: githubOutput,
    RUNNER_TEMP: runnerTemp
  };

  await assert.rejects(
    () => runAction({ env, spawn: mockSpawn }),
    /contains malformed JSON/
  );
}));

test('Report validation rejects invalid schemaVersion and missing fields', () => {
  assert.throws(
    () => validateReportStructure({ schemaVersion: 1, tool: 'cloneproof', status: 'passed', findings: [] }),
    /Unsupported report schemaVersion/
  );

  assert.throws(
    () => validateReportStructure({ schemaVersion: 2, tool: 'other', status: 'passed', findings: [] }),
    /Unexpected report tool identifier/
  );

  assert.throws(
    () => validateReportStructure({ schemaVersion: 2, tool: 'cloneproof', status: 'unknown', findings: [] }),
    /Invalid or missing report status/
  );

  assert.throws(
    () => validateReportStructure({ schemaVersion: 2, tool: 'cloneproof', status: 'passed', findings: 'not-array' }),
    /Report findings must be an array/
  );
});

test('GITHUB_OUTPUT generation and newline injection prevention', () => withTempDir('cloneproof-action-output-test-', (dir) => {
  const outputFile = path.join(dir, 'output.txt');

  exportOutput(outputFile, 'status', 'passed');
  exportOutput(outputFile, 'report-path', 'C:/path/report.json');

  const content = fs.readFileSync(outputFile, 'utf8');
  assert.equal(content, 'status=passed\nreport-path=C:/path/report.json\n');

  assert.throws(
    () => exportOutput(outputFile, 'status', 'passed\nINJECTED=malicious'),
    /contains forbidden newline characters/
  );

  assert.throws(
    () => exportOutput(outputFile, 'status', 'passed\r\nINJECTED=malicious'),
    /contains forbidden newline characters/
  );

  assert.throws(
    () => exportOutput(outputFile, 'invalid name!', 'val'),
    /Invalid output name/
  );
}));

test('No shell execution during child process invocation', async () => withTempDirAsync('cloneproof-action-no-shell-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const targetDir = path.join(dir, 'repo');
  fs.mkdirSync(runnerTemp, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const reportPath = path.join(runnerTemp, 'report.json');
  let spawnOptions = null;
  let spawnArgs = null;

  const mockSpawn = (cmd, args, options) => {
    spawnArgs = args;
    spawnOptions = options;
    fs.writeFileSync(reportPath, JSON.stringify({
      schemaVersion: 2,
      tool: 'cloneproof',
      status: 'passed',
      findings: []
    }));
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        if (event === 'close') setTimeout(() => handler(0, null), 10);
      }
    };
  };

  const env = {
    GITHUB_WORKSPACE: dir,
    'INPUT_TARGET-PATH': targetDir,
    'INPUT_REPORT-PATH': reportPath,
    GITHUB_OUTPUT: githubOutput,
    RUNNER_TEMP: runnerTemp
  };

  await runAction({ env, spawn: mockSpawn });

  assert.ok(spawnOptions);
  assert.equal(spawnOptions.shell, false, 'shell must be explicitly false');
  assert.ok(Array.isArray(spawnArgs), 'Arguments must be passed as an array');
  assert.equal(spawnArgs[1], 'check');
}));

test('No secret propagation to child process environment', () => {
  const dirtyEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    GITHUB_TOKEN: 'ghp_secret_token_value',
    CLONEPROOF_GITHUB_TOKEN: 'cloneproof_secret',
    ACTIONS_RUNTIME_TOKEN: 'runtime_secret',
    INPUT_TARGET_PATH: '.',
    MY_SECRET_KEY: 'secret123'
  };

  const filtered = filterChildEnvironment(dirtyEnv);
  assert.equal(filtered.PATH, '/usr/bin');
  assert.equal(filtered.HOME, '/home/user');
  assert.equal(filtered.GITHUB_TOKEN, undefined);
  assert.equal(filtered.CLONEPROOF_GITHUB_TOKEN, undefined);
  assert.equal(filtered.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(filtered.INPUT_TARGET_PATH, undefined);
  assert.equal(filtered.MY_SECRET_KEY, undefined);
});

test('Sanitizes untrusted workflow command lines in child output', () => {
  assert.equal(
    sanitizeWorkflowCommandText('::error::malicious command'),
    ' ::error::malicious command'
  );
  assert.equal(
    sanitizeWorkflowCommandText('normal text\n::warning::cmd\nmore text'),
    'normal text\n ::warning::cmd\nmore text'
  );

  let captured = '';
  const mockDest = {
    write: (text) => { captured += text; }
  };
  const listeners = {};
  const mockStream = {
    on: (event, handler) => { listeners[event] = handler; }
  };

  pipeSanitizedOutput(mockStream, mockDest);
  listeners.data(Buffer.from('::set-output name=leak::bad\nordinary line\n'));
  listeners.end();

  assert.equal(captured, ' ::set-output name=leak::bad\nordinary line\n');
});

test('Windows-compatible path handling', () => withTempDir('cloneproof-action-winpath-', (dir) => {
  const subTarget = path.join(dir, 'sub', 'target');
  fs.mkdirSync(subTarget, { recursive: true });

  const winSlashesTarget = 'sub\\target';
  const validated = validateTargetPath(winSlashesTarget, dir);
  assert.equal(normalizePathForComparison(validated), normalizePathForComparison(subTarget));

  const relDotSlash = '.\\sub\\target';
  const validatedRel = validateTargetPath(relDotSlash, dir);
  assert.equal(normalizePathForComparison(validatedRel), normalizePathForComparison(subTarget));

  assert.equal(isSubPath(dir, subTarget), true);
}));

test('CLI entrypoint resolution from GITHUB_ACTION_PATH and fallback', () => {
  const resolvedFallback = resolveCliEntrypoint(undefined);
  assert.equal(fs.existsSync(resolvedFallback), true);
  assert.match(resolvedFallback, /src[/\\]cli\.js$/);

  const resolvedCustom = resolveCliEntrypoint(projectRoot);
  assert.equal(fs.existsSync(resolvedCustom), true);

  assert.throws(
    () => resolveCliEntrypoint(path.join(os.tmpdir(), 'non-existent-action-path')),
    /CloneProof CLI entrypoint not found/
  );
});

test('Input reading supports both hyphenated and underscored keys', () => {
  assert.equal(getActionInput('target-path', { 'INPUT_TARGET-PATH': './custom' }), './custom');
  assert.equal(getActionInput('target-path', { INPUT_TARGET_PATH: './underscored' }), './underscored');
  assert.equal(getActionInput('target-path', {}), '');
});

test('Subprocess CLI execution of src/action/index.js end-to-end', () => withTempDir('cloneproof-action-e2e-', (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const healthyFixture = path.join(projectRoot, 'examples', 'healthy-node');

  const result = spawnSync(process.execPath, [actionScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: projectRoot,
      'INPUT_TARGET-PATH': healthyFixture,
      GITHUB_OUTPUT: githubOutput,
      RUNNER_TEMP: runnerTemp,
      NO_COLOR: '1'
    }
  });

  assert.equal(result.status, 0, `Subprocess failed with: ${result.stderr}`);
  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=passed$/m);
  assert.match(outputContent, /^report-path=.+report\.json$/m);
  assert.match(outputContent, /^verification-status=not_run$/m);
}));

test('Subprocess CLI execution of src/action/index.js on broken fixture returns code 1', () => withTempDir('cloneproof-action-e2e-broken-', (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const brokenFixture = path.join(projectRoot, 'examples', 'broken-node');

  const result = spawnSync(process.execPath, [actionScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: projectRoot,
      'INPUT_TARGET-PATH': brokenFixture,
      GITHUB_OUTPUT: githubOutput,
      RUNNER_TEMP: runnerTemp,
      NO_COLOR: '1'
    }
  });

  assert.equal(result.status, 1, `Subprocess expected exit code 1, got ${result.status}. Output: ${result.stderr}`);
  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=failed$/m);
}));

test('Subprocess execution on broken fixture emits workflow annotations and writes step summary', () => withTempDir('cloneproof-action-summary-e2e-', (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'step_summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const brokenFixture = path.join(projectRoot, 'examples', 'broken-node');

  const result = spawnSync(process.execPath, [actionScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: projectRoot,
      'INPUT_TARGET-PATH': brokenFixture,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: stepSummary,
      RUNNER_TEMP: runnerTemp,
      NO_COLOR: '1'
    }
  });

  assert.equal(result.status, 1, `Subprocess expected exit code 1, got ${result.status}. Stderr: ${result.stderr}`);

  // Annotations emitted to stdout
  assert.match(result.stdout, /::error /);
  assert.match(result.stdout, /title=TEST_SCRIPT_MISSING/);
  assert.match(result.stdout, /file=examples\/broken-node\/package\.json/);

  // Job summary written to GITHUB_STEP_SUMMARY
  assert.equal(fs.existsSync(stepSummary), true, 'Step summary file must exist');
  const summaryContent = fs.readFileSync(stepSummary, 'utf8');
  assert.match(summaryContent, /# CloneProof Repository Check/);
  assert.match(summaryContent, /\*\*Result:\*\* FAILED/);
  assert.match(summaryContent, /\| Metric \| Count \|/);
  assert.match(summaryContent, /`TEST_SCRIPT_MISSING`/);
  assert.match(summaryContent, /`examples\/broken-node\/package\.json`/);
  assert.match(summaryContent, /`examples\/broken-node\/src\/index\.js:1`/);
  assert.match(summaryContent, /### Scopes not checked/);
  assert.match(summaryContent, /## Report Location/);
}));

test('Subprocess execution on healthy fixture emits no annotations and writes clean step summary', () => withTempDir('cloneproof-action-healthy-summary-', (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'step_summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const healthyFixture = path.join(projectRoot, 'examples', 'healthy-node');

  const result = spawnSync(process.execPath, [actionScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: projectRoot,
      'INPUT_TARGET-PATH': healthyFixture,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: stepSummary,
      RUNNER_TEMP: runnerTemp,
      NO_COLOR: '1'
    }
  });

  assert.equal(result.status, 0, `Subprocess failed with: ${result.stderr}`);

  // No annotations emitted for healthy fixture
  assert.doesNotMatch(result.stdout, /::error /);
  assert.doesNotMatch(result.stdout, /::warning /);
  assert.doesNotMatch(result.stdout, /::notice /);

  // Job summary indicates success
  assert.equal(fs.existsSync(stepSummary), true);
  const summaryContent = fs.readFileSync(stepSummary, 'utf8');
  assert.match(summaryContent, /# CloneProof Repository Check/);
  assert.match(summaryContent, /\*\*Result:\*\* PASSED/);
  assert.match(summaryContent, /No issues or warnings detected\./);
}));

test('Step summary write error does not crash Action or change exit code', () => withTempDir('cloneproof-action-summary-err-', (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const brokenFixture = path.join(projectRoot, 'examples', 'broken-node');
  // Point GITHUB_STEP_SUMMARY to an impossible non-existent subfolder to force write failure
  const invalidSummaryPath = path.join(dir, 'non_existent_dir', 'sub', 'summary.md');

  const result = spawnSync(process.execPath, [actionScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: projectRoot,
      'INPUT_TARGET-PATH': brokenFixture,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: invalidSummaryPath,
      RUNNER_TEMP: runnerTemp,
      NO_COLOR: '1'
    }
  });

  // Original exit code 1 must be preserved despite summary failure
  assert.equal(result.status, 1);
  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=failed$/m);
  // Stderr should contain a safe diagnostic
  assert.match(result.stderr, /failed to write job summary/);
}));

test('validateMode accepts valid modes and rejects invalid modes', () => {
  assert.equal(validateMode(undefined), 'check');
  assert.equal(validateMode(''), 'check');
  assert.equal(validateMode('  '), 'check');
  assert.equal(validateMode('check'), 'check');
  assert.equal(validateMode('verify'), 'verify');

  assert.throws(() => validateMode('CHECK'), /Invalid mode/);
  assert.throws(() => validateMode('VERIFY'), /Invalid mode/);
  assert.throws(() => validateMode('docker'), /Invalid mode/);
  assert.throws(() => validateMode('test'), /Invalid mode/);
  assert.throws(() => validateMode('true'), /Invalid mode/);
});

test('validateAllowNetwork validates boolean strings and checks mode restriction', () => {
  assert.equal(validateAllowNetwork(undefined, 'check'), false);
  assert.equal(validateAllowNetwork('', 'check'), false);
  assert.equal(validateAllowNetwork('false', 'check'), false);
  assert.equal(validateAllowNetwork('false', 'verify'), false);
  assert.equal(validateAllowNetwork('true', 'verify'), true);

  // allow-network: true is forbidden in check mode
  assert.throws(
    () => validateAllowNetwork('true', 'check'),
    /allow-network: true is not supported in "check" mode/
  );

  // invalid boolean values
  assert.throws(() => validateAllowNetwork('yes', 'verify'), /Invalid allow-network value/);
  assert.throws(() => validateAllowNetwork('no', 'verify'), /Invalid allow-network value/);
  assert.throws(() => validateAllowNetwork('TRUE', 'verify'), /Invalid allow-network value/);
  assert.throws(() => validateAllowNetwork('False', 'verify'), /Invalid allow-network value/);
  assert.throws(() => validateAllowNetwork('1', 'verify'), /Invalid allow-network value/);
});

test('validateTimeoutMs validates integer bounds and defaults', () => {
  assert.equal(validateTimeoutMs(undefined), 300000);
  assert.equal(validateTimeoutMs(''), 300000);
  assert.equal(validateTimeoutMs('   '), 300000);
  assert.equal(validateTimeoutMs('1000'), 1000);
  assert.equal(validateTimeoutMs('300000'), 300000);
  assert.equal(validateTimeoutMs('600000'), 600000);

  // <= 0
  assert.throws(() => validateTimeoutMs('0'), /Invalid timeout-ms/);
  assert.throws(() => validateTimeoutMs('-1000'), /Invalid timeout-ms/);

  // > 600000
  assert.throws(() => validateTimeoutMs('600001'), /Invalid timeout-ms/);
  assert.throws(() => validateTimeoutMs('1000000'), /Invalid timeout-ms/);

  // non-integer
  assert.throws(() => validateTimeoutMs('abc'), /Invalid timeout-ms/);
  assert.throws(() => validateTimeoutMs('300s'), /Invalid timeout-ms/);
  assert.throws(() => validateTimeoutMs('300.5'), /Invalid timeout-ms/);
});

test('isLinuxRunner detects Linux platform and runner OS accurately', () => {
  assert.equal(isLinuxRunner('linux', 'Linux'), true);
  assert.equal(isLinuxRunner('linux', 'linux'), true);
  assert.equal(isLinuxRunner('linux', undefined), true);

  // non-linux platform
  assert.equal(isLinuxRunner('win32', 'Windows'), false);
  assert.equal(isLinuxRunner('win32', 'Linux'), false);
  assert.equal(isLinuxRunner('darwin', 'macOS'), false);

  // non-linux runner OS on linux host
  assert.equal(isLinuxRunner('linux', 'Windows'), false);
  assert.equal(isLinuxRunner('linux', 'macOS'), false);
});

test('isAllowedVerifyEvent permits push and workflow_dispatch and rejects untrusted events', () => {
  assert.equal(isAllowedVerifyEvent('push'), true);
  assert.equal(isAllowedVerifyEvent('workflow_dispatch'), true);
  assert.equal(isAllowedVerifyEvent(' push '), true);

  assert.equal(isAllowedVerifyEvent('pull_request'), false);
  assert.equal(isAllowedVerifyEvent('pull_request_target'), false);
  assert.equal(isAllowedVerifyEvent('schedule'), false);
  assert.equal(isAllowedVerifyEvent('release'), false);
  assert.equal(isAllowedVerifyEvent(''), false);
  assert.equal(isAllowedVerifyEvent(undefined), false);
  assert.equal(isAllowedVerifyEvent(null), false);
});

test('Verify mode on non-Linux runner blocks verification, runs static check, and returns code 2', async () => withTempDirAsync('cloneproof-action-verify-nonlinux-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const healthyFixture = path.join(projectRoot, 'examples', 'healthy-node');

  const env = {
    GITHUB_WORKSPACE: projectRoot,
    'INPUT_TARGET-PATH': healthyFixture,
    'INPUT_MODE': 'verify',
    RUNNER_OS: 'Windows',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: githubOutput,
    GITHUB_STEP_SUMMARY: stepSummary,
    RUNNER_TEMP: runnerTemp,
    NO_COLOR: '1'
  };

  const exitCode = await runAction({ env, platform: 'win32' });
  assert.equal(exitCode, 2, 'Action must return exit code 2 when verification is blocked');

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=blocked$/m);
  assert.match(outputContent, /^verification-status=blocked$/m);

  const match = outputContent.match(/^report-path=(.+)$/m);
  assert.ok(match);
  const reportPath = match[1].trim();
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'blocked');
  assert.ok(report.findings.some((f) => f.code === 'DOCKER_UNAVAILABLE'));

  const summaryContent = fs.readFileSync(stepSummary, 'utf8');
  assert.match(summaryContent, /## Docker Verification/);
  assert.match(summaryContent, /`DOCKER_UNAVAILABLE`/);
}));

test('Verify mode on pull_request event blocks verification, runs static check, and returns code 2', async () => withTempDirAsync('cloneproof-action-verify-pr-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const healthyFixture = path.join(projectRoot, 'examples', 'healthy-node');

  const env = {
    GITHUB_WORKSPACE: projectRoot,
    'INPUT_TARGET-PATH': healthyFixture,
    'INPUT_MODE': 'verify',
    RUNNER_OS: 'Linux',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_OUTPUT: githubOutput,
    GITHUB_STEP_SUMMARY: stepSummary,
    RUNNER_TEMP: runnerTemp,
    NO_COLOR: '1'
  };

  const exitCode = await runAction({ env, platform: 'linux' });
  assert.equal(exitCode, 2, 'Action must return exit code 2 when event is restricted');

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=blocked$/m);
  assert.match(outputContent, /^verification-status=blocked$/m);

  const match = outputContent.match(/^report-path=(.+)$/m);
  assert.ok(match);
  const reportPath = match[1].trim();
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'blocked');
  assert.ok(report.findings.some((f) => f.code === 'DOCKER_EXECUTION_CONSENT_REQUIRED'));

  const summaryContent = fs.readFileSync(stepSummary, 'utf8');
  assert.match(summaryContent, /## Docker Verification/);
  assert.match(summaryContent, /`DOCKER_EXECUTION_CONSENT_REQUIRED`/);
}));

test('Verify mode blocks and returns code 2 when Docker setup fails', async () => withTempDirAsync('cloneproof-action-verify-setup-fail-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const targetDir = path.join(dir, 'workspace');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { test: 'node -e "process.exit(0)"' } }));

  const customReportPath = path.join(runnerTemp, 'report.json');

  const mockSpawn = (command, args, options) => {
    if (args.includes('setup')) {
      return {
        stdout: { on: () => {} },
        stderr: { on: (event, handler) => { if (event === 'data') handler(Buffer.from('Docker daemon not responding\n')); } },
        on: (event, handler) => {
          if (event === 'close') setTimeout(() => handler(1, null), 10);
        }
      };
    }
    if (args.includes('check')) {
      fs.writeFileSync(customReportPath, JSON.stringify({
        schemaVersion: 2,
        tool: 'cloneproof',
        status: 'passed',
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
        findings: []
      }), 'utf8');
      return {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, handler) => {
          if (event === 'close') setTimeout(() => handler(0, null), 10);
        }
      };
    }
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        if (event === 'close') setTimeout(() => handler(0, null), 10);
      }
    };
  };

  const env = {
    GITHUB_WORKSPACE: dir,
    'INPUT_TARGET-PATH': targetDir,
    'INPUT_REPORT-PATH': customReportPath,
    'INPUT_MODE': 'verify',
    RUNNER_OS: 'Linux',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: githubOutput,
    GITHUB_STEP_SUMMARY: stepSummary,
    RUNNER_TEMP: runnerTemp
  };

  const exitCode = await runAction({ env, spawn: mockSpawn, platform: 'linux' });
  assert.equal(exitCode, 2);

  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=blocked$/m);
  assert.match(outputContent, /^verification-status=blocked$/m);

  const report = JSON.parse(fs.readFileSync(customReportPath, 'utf8'));
  assert.equal(report.status, 'blocked');
  assert.ok(report.findings.some((f) => f.code === 'DOCKER_IMAGE_UNAVAILABLE'));
}));

test('Verify mode runs setup and verify CLI commands with correct flags and timeout', async () => withTempDirAsync('cloneproof-action-verify-success-', async (dir) => {
  const runnerTemp = path.join(dir, 'temp');
  const githubOutput = path.join(dir, 'output.txt');
  const stepSummary = path.join(dir, 'summary.md');
  fs.mkdirSync(runnerTemp, { recursive: true });

  const targetDir = path.join(dir, 'workspace');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { test: 'node -e "process.exit(0)"' } }));

  const customReportPath = path.join(runnerTemp, 'report.json');

  const spawnedCalls = [];
  const mockSpawn = (command, args, options) => {
    spawnedCalls.push({ command, args, options });
    if (args.includes('verify')) {
      fs.writeFileSync(customReportPath, JSON.stringify({
        schemaVersion: 2,
        tool: 'cloneproof',
        status: 'passed',
        summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
        findings: [],
        verification: {
          requested: true,
          outcome: 'passed',
          image: 'docker.io/library/node:24-bookworm-slim',
          networkConsent: true,
          networkMode: 'bridge',
          durationMs: 4200,
          commands: {
            install: { command: 'npm ci', exitCode: 0, durationMs: 2100 },
            test: { command: 'npm test', exitCode: 0, durationMs: 2100 }
          },
          security: {
            nonRootUser: true,
            networkIsolated: false,
            readOnlyRootFs: true,
            droppedCapabilities: true
          }
        }
      }), 'utf8');
    }
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        if (event === 'close') setTimeout(() => handler(0, null), 10);
      }
    };
  };

  const env = {
    GITHUB_WORKSPACE: dir,
    'INPUT_TARGET-PATH': targetDir,
    'INPUT_REPORT-PATH': customReportPath,
    'INPUT_MODE': 'verify',
    'INPUT_ALLOW-NETWORK': 'true',
    'INPUT_TIMEOUT-MS': '120000',
    RUNNER_OS: 'Linux',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: githubOutput,
    GITHUB_STEP_SUMMARY: stepSummary,
    RUNNER_TEMP: runnerTemp
  };

  const exitCode = await runAction({ env, spawn: mockSpawn, platform: 'linux' });
  assert.equal(exitCode, 0);

  // Check spawned commands: first setup, then verify
  assert.equal(spawnedCalls.length, 2);
  assert.ok(spawnedCalls[0].args.includes('setup'));
  assert.ok(spawnedCalls[1].args.includes('verify'));
  assert.ok(spawnedCalls[1].args.includes('--docker'));
  assert.ok(spawnedCalls[1].args.includes('--execute'));
  assert.ok(spawnedCalls[1].args.includes('--allow-network'));
  assert.ok(spawnedCalls[1].args.includes('--timeout-ms'));
  const timeoutIndex = spawnedCalls[1].args.indexOf('--timeout-ms');
  assert.equal(spawnedCalls[1].args[timeoutIndex + 1], '120000');

  // Verify outputs
  const outputContent = fs.readFileSync(githubOutput, 'utf8');
  assert.match(outputContent, /^status=passed$/m);
  assert.match(outputContent, /^verification-status=passed$/m);

  // Verify step summary contains Docker Verification table
  const summaryContent = fs.readFileSync(stepSummary, 'utf8');
  assert.match(summaryContent, /## Docker Verification/);
  assert.match(summaryContent, /\*\*Verification result:\*\* PASSED/);
  assert.match(summaryContent, /\| Docker image \| `docker\.io\/library\/node:24-bookworm-slim` \|/);
  assert.match(summaryContent, /\| Network access \| Enabled \|/);
}));
