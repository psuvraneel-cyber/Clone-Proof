'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const { runAction, validateReceiptPath } = require('../src/action/index');
const { renderJobSummary, MAX_SUMMARY_BYTES } = require('../src/action/summary');
const { parseArguments } = require('../src/cli');
const { attachIntegrity, digestPayload } = require('../src/receipt/digest');
const { verifyReceiptContent } = require('../src/receipt');
const {
  BROKEN_EXAMPLE,
  COMMIT,
  FIXED_TIME,
  HEALTHY_EXAMPLE,
  PROJECT_ROOT,
  SECRET,
  checkReport,
  copyExample,
  makeGitCheckout,
  verifyReport
} = require('./receipt-fixtures');

const CLI = path.join(PROJECT_ROOT, 'src', 'cli.js');

function withTempDir(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-receipt-int-'));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  let result;
  try {
    result = fn(directory);
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(cleanup);
  cleanup();
  return result;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...options.env },
    cwd: options.cwd || PROJECT_ROOT
  });
}

function readReceipt(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('CLI parses --receipt and keeps the existing option shape without it', () => {
  const withReceipt = parseArguments(['node', 'cli', 'check', '.', '--receipt', 'r.json']);
  assert.equal(withReceipt.receiptPath, 'r.json');
  assert.equal(parseArguments(['node', 'cli', 'check', '.', '--receipt=r.json']).receiptPath, 'r.json');
  assert.equal(Object.prototype.hasOwnProperty.call(parseArguments(['node', 'cli', 'check', '.']), 'receiptPath'), false);
  assert.deepEqual(parseArguments(['node', 'cli', 'receipt', 'verify', 'r.json']), { command: 'receipt', subcommand: 'verify', receiptFile: 'r.json' });

  assert.throws(() => parseArguments(['node', 'cli', 'check', '.', '--receipt']), /Missing receipt file path/);
  assert.throws(() => parseArguments(['node', 'cli', 'check', '.', '--receipt', '--format']), /Missing receipt file path/);
  assert.throws(() => parseArguments(['node', 'cli', 'check', '.', '--output', 'same.json', '--receipt', 'same.json']), /different files/);
  assert.throws(() => parseArguments(['node', 'cli', 'setup', '--receipt', 'r.json']), /setup does not accept --receipt/);
  assert.throws(() => parseArguments(['node', 'cli', 'receipt']), /Unknown receipt subcommand/);
  assert.throws(() => parseArguments(['node', 'cli', 'receipt', 'sign', 'r.json']), /Unknown receipt subcommand/);
  assert.throws(() => parseArguments(['node', 'cli', 'receipt', 'verify']), /requires a receipt file path/);
  assert.throws(() => parseArguments(['node', 'cli', 'receipt', 'verify', 'a', 'b']), /Unexpected extra argument/);
});

test('CLI check with --receipt writes a valid receipt and leaves the report byte-identical', () => withTempDir((directory) => {
  const target = copyExample(HEALTHY_EXAMPLE, path.join(directory, 'project'));
  makeGitCheckout(target);
  const plainReport = path.join(directory, 'plain.json');
  const report = path.join(directory, 'report.json');
  const receipt = path.join(directory, 'nested', 'receipt.json');

  const plain = runCli(['check', target, '--format', 'json', '--output', plainReport]);
  const withReceipt = runCli(['check', target, '--format', 'json', '--output', report, '--receipt', receipt]);
  assert.equal(plain.status, 0);
  assert.equal(withReceipt.status, plain.status);
  assert.equal(fs.readFileSync(report, 'utf8'), fs.readFileSync(plainReport, 'utf8'));
  assert.match(withReceipt.stderr, /wrote receipt to .*\(sha256 [0-9a-f]{64}\)/);

  const parsed = readReceipt(receipt);
  const reportJson = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(parsed.source.commit, COMMIT);
  assert.equal(parsed.source.ref, 'refs/heads/main');
  assert.equal(parsed.source.identitySource, 'local-git-metadata');
  assert.equal(parsed.execution.invocation, 'cli');
  assert.equal(parsed.result.status, reportJson.status);
  assert.deepEqual(parsed.result.summary, reportJson.summary);
  assert.equal(verifyReceiptContent(fs.readFileSync(receipt)).status, 'ok');
  assert.ok(!fs.readFileSync(receipt, 'utf8').includes(directory.replace(/\\/g, '\\\\')));

  const verified = runCli(['receipt', 'verify', receipt]);
  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /Receipt verified/);
  assert.match(verified.stdout, /not a signature/);
}));

test('CLI check without --receipt behaves as before and writes no receipt', () => withTempDir((directory) => {
  const before = fs.readdirSync(directory);
  const result = runCli(['check', BROKEN_EXAMPLE, '--format', 'json']);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /receipt/i);
  assert.deepEqual(fs.readdirSync(directory), before);
}));

test('CLI exit codes are unchanged by --receipt', () => withTempDir((directory) => {
  for (const [target, expected] of [[HEALTHY_EXAMPLE, 0], [BROKEN_EXAMPLE, 1], [path.join(directory, 'missing-folder'), 2]]) {
    const receipt = path.join(directory, `receipt-${expected}.json`);
    const plain = runCli(['check', target, '--format', 'json']);
    const withReceipt = runCli(['check', target, '--format', 'json', '--receipt', receipt]);
    assert.equal(plain.status, expected);
    assert.equal(withReceipt.status, expected);
    assert.equal(withReceipt.stdout, plain.stdout);
    assert.equal(verifyReceiptContent(fs.readFileSync(receipt)).status, 'ok');
  }
}));

test('CLI verify with --receipt records a blocked verification without claiming execution', () => withTempDir((directory) => {
  const report = path.join(directory, 'report.json');
  const receipt = path.join(directory, 'receipt.json');
  const plain = runCli(['verify', BROKEN_EXAMPLE, '--docker', '--execute', '--format', 'json']);
  const result = runCli(['verify', BROKEN_EXAMPLE, '--docker', '--execute', '--format', 'json', '--output', report, '--receipt', receipt]);
  assert.equal(result.status, 2);
  assert.equal(result.status, plain.status);
  const reportJson = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(reportJson.verification.outcome, 'blocked');
  const parsed = readReceipt(receipt);
  assert.equal(parsed.execution.mode, 'verify');
  assert.equal(parsed.execution.verificationRequested, true);
  assert.equal(parsed.execution.verificationAuthorized, true);
  assert.equal(parsed.execution.repositoryCommandsExecuted, false);
  assert.equal(parsed.execution.repositoryCommandsEnvironment, 'none');
  assert.equal(parsed.execution.container.networkPolicy, 'none');
  assert.match(parsed.execution.container.imageDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(parsed.result.verificationOutcome, 'blocked');
  assert.equal(parsed.result.status, reportJson.status);
  assert.equal(runCli(['receipt', 'verify', receipt]).status, 0);
}));

test('CLI verify without consent writes no receipt and keeps exit code 2', () => withTempDir((directory) => {
  const receipt = path.join(directory, 'receipt.json');
  const result = runCli(['verify', HEALTHY_EXAMPLE, '--receipt', receipt]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /receipt was not created because no report was produced/);
  assert.equal(fs.existsSync(receipt), false);
}));

test('CLI receipt path problems are reported separately and do not change the exit code', () => withTempDir((directory) => {
  const receiptDirectory = path.join(directory, 'is-a-directory');
  fs.mkdirSync(receiptDirectory);
  const result = runCli(['check', HEALTHY_EXAMPLE, '--format', 'json', '--receipt', receiptDirectory]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /receipt was not created: The receipt destination is a directory/);
  assert.match(result.stderr, /report and exit code are unaffected/);
  assert.match(result.stdout, /"schemaVersion": 2/);

  const collision = runCli(['check', HEALTHY_EXAMPLE, '--output', path.join(directory, 'x.json'), '--receipt', path.join(directory, '.', 'x.json')]);
  assert.equal(collision.status, 2);
  assert.match(collision.stderr, /--receipt and --output must name different files/);
}));

test('CLI receipt verify distinguishes digest, schema, version, JSON, and file errors', () => withTempDir((directory) => {
  const receipt = path.join(directory, 'receipt.json');
  assert.equal(runCli(['check', HEALTHY_EXAMPLE, '--format', 'json', '--receipt', receipt]).status, 0);
  const original = readReceipt(receipt);

  const tamperedPath = path.join(directory, 'tampered.json');
  fs.writeFileSync(tamperedPath, JSON.stringify({ ...original, result: { ...original.result, status: 'failed' } }));
  const tampered = runCli(['receipt', 'verify', tamperedPath]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /Receipt integrity check FAILED/);
  assert.match(tampered.stderr, new RegExp(`recorded: ${original.integrity.digest}`));

  const schemaPath = path.join(directory, 'schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(attachIntegrity({ ...digestPayload(original), extra: true })));
  const schema = runCli(['receipt', 'verify', schemaPath]);
  assert.equal(schema.status, 1);
  assert.match(schema.stderr, /Receipt schema validation FAILED/);
  assert.match(schema.stderr, /\/extra: is not an allowed property/);

  const versionPath = path.join(directory, 'version.json');
  fs.writeFileSync(versionPath, JSON.stringify({ ...original, receiptVersion: 9 }));
  const version = runCli(['receipt', 'verify', versionPath]);
  assert.equal(version.status, 2);
  assert.match(version.stderr, /Unsupported receiptVersion 9/);

  const malformedPath = path.join(directory, 'malformed.json');
  fs.writeFileSync(malformedPath, '{"receiptVersion": 1,');
  assert.equal(runCli(['receipt', 'verify', malformedPath]).status, 2);

  const largePath = path.join(directory, 'large.json');
  fs.writeFileSync(largePath, ' '.repeat(1024 * 1024 + 1));
  const large = runCli(['receipt', 'verify', largePath]);
  assert.equal(large.status, 2);
  assert.match(large.stderr, /byte limit/);

  const missing = runCli(['receipt', 'verify', path.join(directory, 'missing.json')]);
  assert.equal(missing.status, 2);
  assert.doesNotMatch(missing.stderr, /missing\.json/);
  assert.equal(runCli(['receipt', 'verify', directory]).status, 2);
  assert.equal(runCli(['receipt', 'verify']).status, 2);
}));

test('CLI receipt output and diagnostics never include environment secrets', () => withTempDir((directory) => {
  const receipt = path.join(directory, 'receipt.json');
  const env = {
    GITHUB_TOKEN: SECRET,
    NPM_TOKEN: SECRET,
    PRIVATE_REGISTRY_PASSWORD: SECRET,
    CLONEPROOF_GITHUB_TOKEN: SECRET,
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW: `/tmp/${SECRET}`,
    GITHUB_REF: `refs/heads/${SECRET}=x`
  };
  const result = runCli(['check', HEALTHY_EXAMPLE, '--format', 'json', '--receipt', receipt], { env });
  assert.equal(result.status, 0);
  for (const text of [result.stdout, result.stderr, fs.readFileSync(receipt, 'utf8')]) {
    assert.ok(!text.includes(SECRET));
  }
  const verified = runCli(['receipt', 'verify', receipt], { env });
  assert.ok(!verified.stdout.includes(SECRET) && !verified.stderr.includes(SECRET));
}));

// ---------------------------------------------------------------------------
// GitHub Action
// ---------------------------------------------------------------------------

function actionEnvironment(directory, extra = {}) {
  const workspace = path.join(directory, 'workspace');
  const runnerTemp = path.join(directory, 'runner-temp');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(runnerTemp, { recursive: true });
  return {
    workspace,
    runnerTemp,
    output: path.join(directory, 'github-output.txt'),
    summary: path.join(directory, 'step-summary.md'),
    env: {
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: path.join(directory, 'github-output.txt'),
      GITHUB_STEP_SUMMARY: path.join(directory, 'step-summary.md'),
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'octo-org/sample-repo',
      GITHUB_WORKFLOW: 'CI',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: COMMIT,
      RUNNER_OS: 'Linux',
      RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_TOKEN: SECRET,
      ACTIONS_RUNTIME_TOKEN: SECRET,
      NPM_TOKEN: SECRET,
      ...extra
    }
  };
}

function parseOutputs(file) {
  const outputs = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const index = line.indexOf('=');
    outputs[line.slice(0, index)] = line.slice(index + 1);
  }
  return outputs;
}

function captureStream() {
  const chunks = [];
  return { write: (chunk) => { chunks.push(String(chunk)); return true; }, text: () => chunks.join('') };
}

function mockSpawn(reportFor, calls) {
  return (command, args, options) => {
    calls.push(args);
    const outputIndex = args.indexOf('--output');
    if (outputIndex >= 0) {
      const report = reportFor(args);
      if (report) fs.writeFileSync(args[outputIndex + 1], JSON.stringify(report), 'utf8');
    }
    assert.equal(options.shell, false);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        if (event === 'close') setTimeout(() => handler(0, null), 5);
      }
    };
  };
}

function assertSafeSummary(summary, setup) {
  for (const value of [setup.workspace, setup.runnerTemp, setup.workspace.replace(/\\/g, '/'), setup.runnerTemp.replace(/\\/g, '/'), SECRET, os.tmpdir()]) {
    assert.ok(!summary.includes(value), `summary leaked ${value}`);
  }
}

test('Action check mode creates a receipt at the default RUNNER_TEMP location using the real CLI', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  makeGitCheckout(setup.workspace);
  const stderr = captureStream();
  const stdout = captureStream();
  const calls = [];
  const trackingSpawn = (command, args, options) => {
    calls.push(args);
    return spawn(command, args, options);
  };

  const exitCode = await runAction({ env: setup.env, targetPath: 'app', spawn: trackingSpawn, stdout, stderr, now: FIXED_TIME });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1, 'receipt generation must not run the CLI again');

  const outputs = parseOutputs(setup.output);
  const expectedReceipt = path.join(setup.runnerTemp, 'cloneproof', 'receipt.json');
  assert.equal(outputs.status, 'passed');
  assert.equal(outputs['verification-status'], 'not_run');
  assert.equal(outputs['report-path'], path.join(setup.runnerTemp, 'cloneproof', 'report.json'));
  assert.equal(outputs['receipt-status'], 'created');
  assert.equal(outputs['receipt-path'], expectedReceipt);

  const receipt = readReceipt(expectedReceipt);
  assert.equal(verifyReceiptContent(fs.readFileSync(expectedReceipt)).status, 'ok');
  assert.equal(receipt.execution.invocation, 'github-action');
  assert.equal(receipt.source.commit, COMMIT);
  assert.equal(receipt.source.subdirectory, 'app');
  assert.equal(receipt.source.repository, 'octo-org/sample-repo');
  assert.equal(receipt.source.url, 'https://github.com/octo-org/sample-repo');
  assert.equal(receipt.environment.github.runId, '42');
  assert.equal(receipt.generatedAt, FIXED_TIME.toISOString());

  const report = JSON.parse(fs.readFileSync(outputs['report-path'], 'utf8'));
  assert.equal(receipt.result.status, report.status);
  assert.equal(Object.prototype.hasOwnProperty.call(report, 'receipt'), false, 'the report schema is unchanged');

  const summary = fs.readFileSync(setup.summary, 'utf8');
  assert.match(summary, /## Reproducibility Receipt/);
  assert.match(summary, /\*\*Receipt status:\*\* CREATED/);
  assert.match(summary, new RegExp(`\\| Integrity digest \\| \`${receipt.integrity.digest}\` \\|`));
  assert.match(summary, new RegExp(`\\| Source revision \\| \`${COMMIT}\` \\|`));
  assert.match(summary, /\| Execution mode \| Static check \|/);
  assert.match(summary, /\| Verification outcome \| `not_run` \|/);
  assert.match(summary, /\| Receipt location \| `RUNNER_TEMP\/cloneproof\/receipt\.json` \|/);
  assertSafeSummary(summary, setup);
  for (const text of [stdout.text(), stderr.text(), fs.readFileSync(expectedReceipt, 'utf8')]) {
    assert.ok(!text.includes(SECRET));
  }
}));

test('Action repository identity is omitted when the target is not the workspace checkout', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  const other = copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'vendor', 'other'));
  makeGitCheckout(other, { commit: 'f'.repeat(40) });
  const exitCode = await runAction({ env: setup.env, targetPath: 'vendor/other', stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME });
  assert.equal(exitCode, 0);
  const receipt = readReceipt(parseOutputs(setup.output)['receipt-path']);
  assert.equal(receipt.source.commit, 'f'.repeat(40));
  assert.equal(receipt.source.repository, null);
  assert.equal(receipt.source.url, null);
  assert.equal(receipt.environment.github.workflowCommit, COMMIT);
}));

test('Action records unavailable source identity when the workspace has no Git metadata', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const exitCode = await runAction({ env: setup.env, targetPath: 'app', stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME });
  assert.equal(exitCode, 0);
  const receipt = readReceipt(parseOutputs(setup.output)['receipt-path']);
  assert.equal(receipt.source.commit, null);
  assert.equal(receipt.source.revisionIdentity, 'unavailable');
  assert.equal(receipt.source.repository, null);
  assert.match(fs.readFileSync(setup.summary, 'utf8'), /\| Source revision \| Unavailable \|/);
}));

test('Action Docker verification receipt reuses the single verify run', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  makeGitCheckout(setup.workspace);
  const calls = [];
  const report = verifyReport('passed');
  const exitCode = await runAction({
    env: setup.env, mode: 'verify', targetPath: 'app', platform: 'linux',
    spawn: mockSpawn((args) => (args.includes('verify') ? report : null), calls),
    stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(calls.map((args) => args[1]), ['setup', 'verify']);
  const outputs = parseOutputs(setup.output);
  assert.equal(outputs['verification-status'], 'passed');
  assert.equal(outputs['receipt-status'], 'created');
  const receipt = readReceipt(outputs['receipt-path']);
  assert.equal(receipt.execution.repositoryCommandsExecuted, true);
  assert.equal(receipt.execution.repositoryCommandsEnvironment, 'controlled-docker');
  assert.equal(receipt.execution.container.image, report.verification.image);
  assert.equal(receipt.result.verificationOutcome, 'passed');
  assert.equal(receipt.result.cleanup, 'confirmed');
  const summary = fs.readFileSync(setup.summary, 'utf8');
  assert.match(summary, /\| Execution mode \| Docker verification \|/);
  assert.match(summary, /\| Verification outcome \| `passed` \|/);
}));

test('Action failed verification receipt preserves the failure and exit code', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const exitCode = await runAction({
    env: setup.env, mode: 'verify', targetPath: 'app', platform: 'linux',
    spawn: mockSpawn((args) => (args.includes('verify') ? verifyReport('failed') : null), []),
    stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME
  });
  assert.equal(exitCode, 1);
  const outputs = parseOutputs(setup.output);
  assert.equal(outputs.status, 'failed');
  assert.equal(outputs['verification-status'], 'failed');
  const receipt = readReceipt(outputs['receipt-path']);
  assert.equal(receipt.result.status, 'failed');
  assert.equal(receipt.result.verificationOutcome, 'failed');
  assert.equal(receipt.execution.repositoryCommandsExecuted, true);
}));

test('Action blocked verification (untrusted event and non-Linux runner) records no execution', () => withTempDir(async (directory) => {
  for (const [label, overrides] of [
    ['pull_request', { env: { GITHUB_EVENT_NAME: 'pull_request' }, platform: 'linux' }],
    ['windows', { env: { RUNNER_OS: 'Windows' }, platform: 'win32' }]
  ]) {
    const setup = actionEnvironment(path.join(directory, label), overrides.env);
    copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
    const calls = [];
    const exitCode = await runAction({
      env: setup.env, mode: 'verify', targetPath: 'app', platform: overrides.platform,
      spawn: mockSpawn(() => checkReport(), calls),
      stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME
    });
    assert.equal(exitCode, 2, label);
    assert.deepEqual(calls.map((args) => args[1]), ['check'], label);
    const outputs = parseOutputs(setup.output);
    assert.equal(outputs['verification-status'], 'blocked', label);
    assert.equal(outputs['receipt-status'], 'created', label);
    const receipt = readReceipt(outputs['receipt-path']);
    assert.equal(receipt.execution.mode, 'verify', label);
    assert.equal(receipt.execution.verificationAuthorized, false, label);
    assert.equal(receipt.execution.repositoryCommandsExecuted, false, label);
    assert.equal(receipt.result.verificationOutcome, 'blocked', label);
    assert.equal(receipt.result.status, 'blocked', label);
  }
}));

test('Action Docker setup failure records a blocked receipt', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const calls = [];
  const spawnFn = (command, args) => {
    calls.push(args);
    const outputIndex = args.indexOf('--output');
    if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], JSON.stringify(checkReport()));
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => { if (event === 'close') setTimeout(() => handler(args.includes('setup') ? 1 : 0, null), 5); }
    };
  };
  const exitCode = await runAction({ env: setup.env, mode: 'verify', targetPath: 'app', platform: 'linux', spawn: spawnFn, stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME });
  assert.equal(exitCode, 2);
  assert.deepEqual(calls.map((args) => args[1]), ['setup', 'check']);
  const receipt = readReceipt(parseOutputs(setup.output)['receipt-path']);
  assert.equal(receipt.result.verificationOutcome, 'blocked');
  assert.equal(receipt.execution.repositoryCommandsExecuted, false);
}));

test('Action custom receipt-path inside the workspace is honored', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const exitCode = await runAction({
    env: { ...setup.env, 'INPUT_RECEIPT-PATH': 'evidence/cloneproof-receipt.json' },
    targetPath: 'app', stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME
  });
  assert.equal(exitCode, 0);
  const expected = path.join(setup.workspace, 'evidence', 'cloneproof-receipt.json');
  assert.equal(parseOutputs(setup.output)['receipt-path'], expected);
  assert.equal(verifyReceiptContent(fs.readFileSync(expected)).status, 'ok');
  assert.match(fs.readFileSync(setup.summary, 'utf8'), /\| Receipt location \| `evidence\/cloneproof-receipt\.json` \|/);
}));

test('Action rejects unsafe receipt paths before running the CLI', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const outside = path.join(directory, 'outside', 'receipt.json');
  fs.mkdirSync(path.join(setup.workspace, 'a-directory'));
  const cases = [
    [outside, /must resolve inside GITHUB_WORKSPACE or RUNNER_TEMP/],
    ['../escape.json', /must resolve inside GITHUB_WORKSPACE or RUNNER_TEMP/],
    ['a-directory', /is a directory/],
    ['.', /must name a file/],
    ['bad\0name.json', /malformed/],
    [path.join(setup.runnerTemp, 'cloneproof', 'report.json'), /must differ from report-path/]
  ];
  for (const [receiptPath, pattern] of cases) {
    const calls = [];
    await assert.rejects(
      runAction({ env: setup.env, targetPath: 'app', receiptPath, spawn: mockSpawn(() => checkReport(), calls), stdout: captureStream(), stderr: captureStream() }),
      (error) => {
        assert.match(error.message, pattern);
        assert.ok(!error.message.includes(directory), 'error must not echo absolute paths');
        return true;
      }
    );
    assert.equal(calls.length, 0, `no CLI run for ${receiptPath}`);
  }
}));

test('Action rejects a receipt-path that collides with a custom report-path', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  await assert.rejects(
    runAction({ env: setup.env, targetPath: 'app', reportPath: 'out/report.json', receiptPath: 'out/./report.json', stdout: captureStream(), stderr: captureStream() }),
    /must differ from report-path/
  );
}));

test('Action rejects receipt-path symlinks that escape the allowed roots', (t) => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  // Directory junctions need no special privilege on Windows, so this half always runs.
  fs.symlinkSync(outside, path.join(setup.workspace, 'linked'), 'junction');
  assert.throws(() => validateReceiptPath('linked/receipt.json', setup.workspace, setup.runnerTemp, null), /resolves outside/);
  try {
    fs.symlinkSync(path.join(outside, 'target.json'), path.join(setup.workspace, 'receipt-link.json'));
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file symlink creation is not permitted on this host (${error.code}); junction escape was checked`);
      return;
    }
    throw error;
  }
  assert.throws(() => validateReceiptPath('receipt-link.json', setup.workspace, setup.runnerTemp, null), /symbolic link/);
}));

test('Action receipt generation failure keeps the report, outputs, and exit code', () => withTempDir(async (directory) => {
  const baseline = actionEnvironment(path.join(directory, 'baseline'));
  copyExample(BROKEN_EXAMPLE, path.join(baseline.workspace, 'app'));
  const baselineExit = await runAction({ env: baseline.env, targetPath: 'app', stdout: captureStream(), stderr: captureStream(), now: FIXED_TIME });

  const setup = actionEnvironment(path.join(directory, 'failing'));
  copyExample(BROKEN_EXAMPLE, path.join(setup.workspace, 'app'));
  const stderr = captureStream();
  const stdout = captureStream();
  const exitCode = await runAction({
    env: setup.env, targetPath: 'app', stdout, stderr, now: FIXED_TIME,
    createReceipt: () => { throw new Error(`boom ${SECRET}`); }
  });
  assert.equal(baselineExit, 1);
  assert.equal(exitCode, baselineExit);

  const outputs = parseOutputs(setup.output);
  assert.equal(outputs.status, 'failed');
  assert.equal(outputs['receipt-status'], 'failed');
  assert.equal(outputs['receipt-path'], '');
  assert.equal(fs.existsSync(path.join(setup.runnerTemp, 'cloneproof', 'receipt.json')), false);
  assert.equal(
    fs.readFileSync(path.join(setup.runnerTemp, 'cloneproof', 'report.json'), 'utf8'),
    fs.readFileSync(path.join(baseline.runnerTemp, 'cloneproof', 'report.json'), 'utf8')
  );
  assert.match(stderr.text(), /reproducibility receipt was not created: Receipt generation failed\./);
  assert.ok(!stderr.text().includes(SECRET), 'unexpected error text is replaced by a fixed message');
  assert.match(stdout.text(), /::error /, 'annotations are still emitted');

  const summary = fs.readFileSync(setup.summary, 'utf8');
  assert.match(summary, /\*\*Receipt status:\*\* FAILED/);
  assert.doesNotMatch(summary, /Integrity digest/);
}));

test('Action report that cannot back a receipt yields receipt-status failed without changing the result', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const inconsistent = checkReport();
  inconsistent.summary.passed += 5;
  const stderr = captureStream();
  const exitCode = await runAction({ env: setup.env, targetPath: 'app', spawn: mockSpawn(() => inconsistent, []), stdout: captureStream(), stderr, now: FIXED_TIME });
  assert.equal(exitCode, 0);
  const outputs = parseOutputs(setup.output);
  assert.equal(outputs.status, 'passed');
  assert.equal(outputs['receipt-status'], 'failed');
  assert.match(stderr.text(), /Report summary is inconsistent with its findings/);
}));

test('Action without RUNNER_TEMP and with a custom report path reports an unavailable default receipt', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(HEALTHY_EXAMPLE, path.join(setup.workspace, 'app'));
  const env = { ...setup.env };
  delete env.RUNNER_TEMP;
  const stderr = captureStream();
  const exitCode = await runAction({ env, targetPath: 'app', reportPath: 'report.json', stdout: captureStream(), stderr, now: FIXED_TIME });
  assert.equal(exitCode, 0);
  const outputs = parseOutputs(setup.output);
  assert.equal(outputs['receipt-status'], 'failed');
  assert.equal(outputs['receipt-path'], '');
  assert.match(stderr.text(), /RUNNER_TEMP is unavailable/);
}));

test('Action keeps the existing outputs and annotations alongside receipt outputs', () => withTempDir(async (directory) => {
  const setup = actionEnvironment(directory);
  copyExample(BROKEN_EXAMPLE, path.join(setup.workspace, 'app'));
  const stdout = captureStream();
  const exitCode = await runAction({ env: setup.env, targetPath: 'app', stdout, stderr: captureStream(), now: FIXED_TIME });
  assert.equal(exitCode, 1);
  const names = fs.readFileSync(setup.output, 'utf8').split('\n').filter(Boolean).map((line) => line.split('=')[0]);
  assert.deepEqual(names, ['status', 'report-path', 'verification-status', 'receipt-path', 'receipt-status']);
  assert.match(stdout.text(), /::error /);
  const summary = fs.readFileSync(setup.summary, 'utf8');
  assert.ok(summary.indexOf('## Report Location') < summary.indexOf('## Reproducibility Receipt'));
}));

test('Receipt summary section survives summary truncation and stays within the size limit', () => {
  const report = checkReport();
  report.status = 'failed';
  report.findings = Array.from({ length: 4000 }, (_, index) => ({
    code: 'LOCKFILE_MISSING', status: 'failed', severity: 'error', title: 't', message: `${'x'.repeat(200)} ${index}`,
    evidence: [], recommendation: 'r'.repeat(100)
  }));
  const digest = 'a'.repeat(64);
  const summary = renderJobSummary(report, {
    workspaceRoot: '/ws', runnerTemp: '/tmp/rt', reportPath: '/tmp/rt/cloneproof/report.json',
    receipt: {
      status: 'created', path: '/tmp/rt/cloneproof/receipt.json', digest,
      receipt: { integrity: { digest }, source: { commit: COMMIT }, execution: { mode: 'check' }, result: { verificationOutcome: 'not_run' } }
    }
  });
  assert.ok(Buffer.byteLength(summary, 'utf8') <= MAX_SUMMARY_BYTES);
  assert.match(summary, /Job summary truncated/);
  assert.match(summary, /## Reproducibility Receipt[\s\S]*\| Integrity digest \| `a{64}` \|/);
});

test('Receipt summary section escapes and bounds unexpected values', () => {
  const summary = renderJobSummary(checkReport(), {
    workspaceRoot: '/ws',
    receipt: {
      status: 'created', path: '/ws/out/`evil|<b>.json', digest: 'b'.repeat(64),
      receipt: { integrity: { digest: 'b'.repeat(64) }, source: { commit: '<script>' }, execution: { mode: '**bold**' }, result: { verificationOutcome: '| injected |' } }
    }
  });
  assert.match(summary, /\| Source revision \| Unavailable \|/);
  assert.match(summary, /\| Execution mode \| Unknown \|/);
  assert.match(summary, /\| Verification outcome \| `unknown` \|/);
  assert.doesNotMatch(summary, /<b>|<script>/);
  const mismatched = renderJobSummary(checkReport(), {
    receipt: { status: 'created', path: '/x', digest: 'c'.repeat(64), receipt: { integrity: { digest: 'd'.repeat(64) } } }
  });
  assert.match(mismatched, /\*\*Receipt status:\*\* FAILED/);
});
