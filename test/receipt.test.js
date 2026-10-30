'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalize,
  createReceipt,
  readLocalGitMetadata,
  serializeReceipt,
  validateReceipt,
  verifyDigest,
  verifyReceiptContent,
  writeFileAtomic
} = require('../src/receipt');
const { attachIntegrity, digestPayload } = require('../src/receipt/digest');
const { compileSchema } = require('../src/receipt/json-schema');
const { version: PACKAGE_VERSION } = require('../package.json');
const {
  BROKEN_EXAMPLE,
  COMMIT,
  FIXED_TIME,
  OTHER_COMMIT,
  PROJECT_ROOT,
  SECRET,
  checkReport,
  clone,
  makeGitCheckout,
  recompute,
  verifyReport
} = require('./receipt-fixtures');

const GIT = { commit: COMMIT, ref: 'refs/heads/main', subdirectory: '.', checkoutRoot: '/ignored' };
const GITHUB_ENV = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'octo-org/sample-repo',
  GITHUB_WORKFLOW: 'CI',
  GITHUB_RUN_ID: '1234567890',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: OTHER_COMMIT,
  RUNNER_OS: 'Linux',
  GITHUB_ACTION_REPOSITORY: 'psuvraneel-cyber/Clone-Proof',
  GITHUB_ACTION_REF: 'v1'
};

function withTempDir(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-receipt-'));
  try {
    return fn(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function receiptFor(report, overrides = {}) {
  return createReceipt({ report, invocation: 'cli', git: GIT, env: {}, now: FIXED_TIME, platform: 'linux', arch: 'x64', nodeVersion: 'v24.0.0', ...overrides });
}

/** Re-digest after a deliberate edit so only schema/consistency rules can reject it. */
function redigest(receipt) {
  return attachIntegrity(digestPayload(receipt));
}

function expectInvalid(receipt, kind, pathPrefix) {
  const result = validateReceipt(receipt);
  assert.equal(result.valid, false, `expected ${pathPrefix} to be rejected`);
  assert.equal(result.kind, kind);
  assert.ok(result.errors.some((error) => error.path.startsWith(pathPrefix)), JSON.stringify(result.errors));
}

// ---------------------------------------------------------------------------
// Creation and schema
// ---------------------------------------------------------------------------

test('valid check-mode receipt records the static run without dynamic claims', () => {
  const report = checkReport();
  const receipt = receiptFor(report);
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(receipt.receiptVersion, 1);
  assert.equal(receipt.receiptType, 'cloneproof.reproducibility');
  assert.equal(receipt.generatedAt, '2026-10-30T00:00:00.000Z');
  assert.deepEqual(receipt.source, {
    kind: 'local', repository: null, url: null, commit: COMMIT, ref: 'refs/heads/main',
    subdirectory: '.', revisionIdentity: 'commit', identitySource: 'local-git-metadata'
  });
  assert.deepEqual(receipt.tool, { name: 'cloneproof', version: PACKAGE_VERSION, receiptGeneratorVersion: 1, reportSchemaVersion: 2, action: null });
  assert.deepEqual(receipt.execution, {
    invocation: 'cli', mode: 'check', verificationRequested: false, verificationAuthorized: false,
    repositoryCommandsExecuted: false, repositoryCommandsEnvironment: 'none', container: null
  });
  assert.equal(receipt.result.verificationOutcome, 'not_run');
  assert.equal(receipt.result.cleanup, 'not_applicable');
  assert.deepEqual(receipt.result.summary, report.summary);
  assert.deepEqual(receipt.result.findings, report.findings.map(({ code, status }) => ({ code, status })));
  assert.deepEqual(receipt.coverage, report.coverage);
  assert.deepEqual(receipt.environment, { runner: 'local', os: 'linux', arch: 'x64', nodeVersion: 'v24.0.0', github: null });
  assert.equal(verifyDigest(receipt).valid, true);
});

test('valid Docker verification receipt records the pinned image and controlled execution', () => {
  const report = verifyReport('passed');
  const receipt = receiptFor(report);
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(receipt.execution.mode, 'verify');
  assert.equal(receipt.execution.verificationRequested, true);
  assert.equal(receipt.execution.verificationAuthorized, true);
  assert.equal(receipt.execution.repositoryCommandsExecuted, true);
  assert.equal(receipt.execution.repositoryCommandsEnvironment, 'controlled-docker');
  assert.equal(receipt.execution.container.image, report.verification.image);
  assert.match(receipt.execution.container.imageDigest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(report.verification.image.endsWith(`@${receipt.execution.container.imageDigest}`));
  assert.equal(receipt.execution.container.networkPolicy, 'none');
  assert.equal(receipt.execution.container.timeoutMs, 300000);
  assert.equal(receipt.result.verificationOutcome, 'passed');
  assert.equal(receipt.result.cleanup, 'confirmed');
});

test('blocked verification receipt never claims execution', () => {
  for (const kind of ['blocked', 'unauthorized']) {
    const report = verifyReport(kind);
    const receipt = receiptFor(report);
    assert.equal(validateReceipt(receipt).valid, true, kind);
    assert.equal(receipt.execution.repositoryCommandsExecuted, false, kind);
    assert.equal(receipt.execution.repositoryCommandsEnvironment, 'none', kind);
    assert.equal(receipt.result.verificationOutcome, 'blocked', kind);
    assert.equal(receipt.result.status, 'blocked', kind);
  }
  assert.equal(receiptFor(verifyReport('unauthorized')).execution.verificationAuthorized, false);
});

test('failed and timed-out verification receipts record execution and failure', () => {
  for (const kind of ['failed', 'timeout']) {
    const receipt = receiptFor(verifyReport(kind));
    assert.equal(validateReceipt(receipt).valid, true, kind);
    assert.equal(receipt.execution.repositoryCommandsExecuted, true, kind);
    assert.equal(receipt.result.verificationOutcome, 'failed', kind);
    assert.equal(receipt.result.status, 'failed', kind);
  }
});

test('verify report without a verification object records an error outcome and no container', () => {
  const report = checkReport();
  report.mode = 'verify';
  const receipt = receiptFor(report);
  assert.equal(receipt.result.verificationOutcome, 'error');
  assert.equal(receipt.execution.container, null);
  assert.equal(receipt.execution.repositoryCommandsExecuted, false);
});

test('cleanup outcome follows the report', () => {
  const failedCleanup = verifyReport('failed');
  failedCleanup.verification.cleanup.cleanupFailed = true;
  assert.equal(receiptFor(failedCleanup).result.cleanup, 'failed');

  const incomplete = verifyReport('failed');
  incomplete.verification.cleanup.completed = false;
  assert.equal(receiptFor(incomplete).result.cleanup, 'incomplete');

  const github = checkReport();
  github.target = { kind: 'github', name: 'octo-org/sample-repo', url: 'https://github.com/octo-org/sample-repo', commit: COMMIT };
  assert.equal(receiptFor(github).result.cleanup, 'confirmed');
  github.target.cleanupFailed = true;
  assert.equal(receiptFor(github).result.cleanup, 'failed');
});

test('missing source identity is recorded as unavailable rather than invented', () => {
  const receipt = receiptFor(checkReport(), { git: null });
  assert.equal(validateReceipt(receipt).valid, true);
  assert.deepEqual(receipt.source, {
    kind: 'local', repository: null, url: null, commit: null, ref: null,
    subdirectory: null, revisionIdentity: 'unavailable', identitySource: 'none'
  });
});

test('short or malformed commit SHAs are not treated as source identity', () => {
  for (const commit of ['0123456', `${COMMIT}0`, 'g'.repeat(40), 'main', '', null]) {
    const receipt = receiptFor(checkReport(), { git: { commit, ref: 'refs/heads/main', subdirectory: '.' } });
    assert.equal(receipt.source.commit, null, String(commit));
    assert.equal(receipt.source.ref, null, 'a branch name alone is never recorded without a commit');
    assert.equal(receipt.source.revisionIdentity, 'unavailable');
  }
  const upper = receiptFor(checkReport(), { git: { commit: COMMIT.toUpperCase() } });
  assert.equal(upper.source.commit, COMMIT);
});

test('GitHub source identity comes only from the validated report target', () => {
  const report = checkReport();
  report.target = { kind: 'github', name: 'octo-org/sample-repo', url: 'https://github.com/octo-org/sample-repo', commit: COMMIT };
  const receipt = receiptFor(report, { git: { commit: OTHER_COMMIT } });
  assert.deepEqual(receipt.source, {
    kind: 'github', repository: 'octo-org/sample-repo', url: 'https://github.com/octo-org/sample-repo', commit: COMMIT,
    ref: null, subdirectory: '.', revisionIdentity: 'commit', identitySource: 'cloneproof-github-clone'
  });

  report.target = { kind: 'github', name: 'octo-org/sample-repo', url: `https://user:${SECRET}@github.com/octo-org/sample-repo` };
  const credentialed = receiptFor(report);
  assert.equal(credentialed.source.url, null);
  assert.equal(credentialed.source.commit, null);
  assert.equal(credentialed.source.identitySource, 'none');
});

test('missing optional GitHub metadata yields nulls, not failures', () => {
  const receipt = receiptFor(checkReport(), { invocation: 'github-action', env: {} });
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(receipt.environment.runner, 'github-actions');
  assert.deepEqual(receipt.environment.github, {
    repository: null, workflow: null, runId: null, runAttempt: null, eventName: null, ref: null, workflowCommit: null, runnerOs: null
  });
  assert.deepEqual(receipt.tool.action, { repository: null, ref: null });
});

test('GitHub Action metadata is validated and recorded', () => {
  const receipt = receiptFor(checkReport(), { invocation: 'github-action', env: GITHUB_ENV, repository: 'octo-org/sample-repo' });
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(receipt.environment.runner, 'github-hosted');
  assert.deepEqual(receipt.environment.github, {
    repository: 'octo-org/sample-repo', workflow: 'CI', runId: '1234567890', runAttempt: 2, eventName: 'push',
    ref: 'refs/heads/main', workflowCommit: OTHER_COMMIT, runnerOs: 'Linux'
  });
  assert.deepEqual(receipt.tool.action, { repository: 'psuvraneel-cyber/Clone-Proof', ref: 'v1' });
  assert.equal(receipt.source.repository, 'octo-org/sample-repo');
  assert.equal(receipt.source.url, 'https://github.com/octo-org/sample-repo');
});

test('invalid GitHub metadata values are dropped to null', () => {
  const receipt = receiptFor(checkReport(), {
    invocation: 'github-action',
    env: {
      ...GITHUB_ENV,
      GITHUB_REPOSITORY: 'not a repo',
      GITHUB_WORKFLOW: '/home/runner/work/.github/workflows/ci.yml',
      GITHUB_RUN_ID: '12a',
      GITHUB_RUN_ATTEMPT: '0',
      GITHUB_EVENT_NAME: 'Push; rm -rf /',
      GITHUB_REF: 'refs/heads/../../etc',
      GITHUB_SHA: 'abc123',
      RUNNER_OS: 'linux',
      RUNNER_ENVIRONMENT: 'cloud',
      GITHUB_ACTION_REF: 'v1\nmalicious'
    }
  });
  assert.equal(validateReceipt(receipt).valid, true);
  assert.deepEqual(receipt.environment.github, {
    repository: null, workflow: null, runId: null, runAttempt: null, eventName: null, ref: null, workflowCommit: null, runnerOs: null
  });
  assert.equal(receipt.environment.runner, 'github-actions');
  assert.equal(receipt.tool.action.ref, null);
});

test('CLI inside GitHub Actions records runner metadata without Action identity', () => {
  const receipt = receiptFor(checkReport(), { env: GITHUB_ENV });
  assert.equal(receipt.environment.runner, 'github-hosted');
  assert.equal(receipt.tool.action, null);
  assert.equal(receipt.execution.invocation, 'cli');
});

test('receipt creation rejects reports that do not match schema version 2', () => {
  const cases = [
    [null, /JSON object/],
    [{ ...checkReport(), schemaVersion: 1 }, /schemaVersion/],
    [{ ...checkReport(), tool: 'other' }, /tool identifier/],
    [{ ...checkReport(), mode: 'scan' }, /mode/],
    [{ ...checkReport(), status: 'great' }, /status/],
    [{ ...checkReport(), findings: {} }, /findings/],
    [{ ...checkReport(), target: { kind: 'ftp' } }, /target kind/],
    [{ ...checkReport(), coverage: { checked: ['unknown-group'], notChecked: [] } }, /unknown group/]
  ];
  for (const [report, pattern] of cases) {
    assert.throws(() => receiptFor(report), pattern);
  }
  assert.throws(() => receiptFor(checkReport(), { invocation: 'api' }), /Invocation/);
  assert.throws(() => receiptFor(checkReport(), { now: new Date('invalid') }), /invalid date/);
  assert.throws(() => receiptFor(checkReport(), { packageVersion: 'latest' }), /semantic version/);
});

test('receipt creation rejects reports whose summary disagrees with findings', () => {
  const report = checkReport();
  report.summary.passed += 1;
  assert.throws(() => receiptFor(report), /summary is inconsistent/);

  const missingWarnings = checkReport();
  delete missingWarnings.summary.warnings;
  assert.throws(() => receiptFor(missingWarnings), /summary.warnings/);

  const badFinding = checkReport();
  badFinding.findings[0].code = 'lower_case';
  assert.throws(() => receiptFor(badFinding), /invalid code or status/);
});

test('receipt creation never modifies the source report', () => {
  for (const report of [checkReport(), verifyReport('passed'), verifyReport('blocked')]) {
    const before = canonicalize(report);
    receiptFor(report);
    assert.equal(canonicalize(report), before);
  }
});

test('receipt modules never import scanning, verification, or process-spawning code', () => {
  const receiptDirectory = path.join(PROJECT_ROOT, 'src', 'receipt');
  for (const file of fs.readdirSync(receiptDirectory).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(receiptDirectory, file), 'utf8');
    assert.doesNotMatch(source, /require\(['"][^'"]*(?:scan\/repository|verify\/docker|input\/github)['"]\)/, file);
    assert.doesNotMatch(source, /child_process/, file);
  }
});

// ---------------------------------------------------------------------------
// Schema and consistency rejection
// ---------------------------------------------------------------------------

test('schema rejects an incorrect version, enum values, unexpected properties, and timestamps', () => {
  const base = receiptFor(checkReport());
  expectInvalid(redigest({ ...base, receiptVersion: 2 }), 'schema', '/receiptVersion');
  expectInvalid(redigest({ ...base, receiptType: 'other' }), 'schema', '/receiptType');
  expectInvalid(redigest({ ...base, unexpected: true }), 'schema', '/unexpected');
  expectInvalid(redigest({ ...base, execution: { ...base.execution, mode: 'scan' } }), 'schema', '/execution/mode');
  expectInvalid(redigest({ ...base, execution: { ...base.execution, extra: 1 } }), 'schema', '/execution/extra');
  expectInvalid(redigest({ ...base, result: { ...base.result, status: 'ok' } }), 'schema', '/result/status');
  expectInvalid(redigest({ ...base, source: { ...base.source, commit: COMMIT.slice(0, 12) } }), 'schema', '/source/commit');
  expectInvalid(redigest({ ...base, source: { ...base.source, commit: COMMIT.toUpperCase() } }), 'schema', '/source/commit');
  expectInvalid(redigest({ ...base, source: { ...base.source, url: `https://x:${SECRET}@github.com/a/b` } }), 'schema', '/source/url');
  expectInvalid(redigest({ ...base, source: { ...base.source, subdirectory: '/abs/path' } }), 'schema', '/source/subdirectory');
  expectInvalid(redigest({ ...base, source: { ...base.source, subdirectory: '../outside' } }), 'schema', '/source/subdirectory');
  expectInvalid(redigest({ ...base, source: { ...base.source, subdirectory: 'C:\\Users\\name' } }), 'schema', '/source/subdirectory');
  for (const generatedAt of ['2026-10-30', '2026-10-30T00:00:00Z', '2026-10-30T00:00:00.000+01:00', 'yesterday']) {
    expectInvalid(redigest({ ...base, generatedAt }), 'schema', '/generatedAt');
  }
  expectInvalid(redigest({ ...base, generatedAt: '2026-02-30T00:00:00.000Z' }), 'consistency', '/generatedAt');
  const { coverage, ...missing } = base;
  assert.ok(coverage);
  expectInvalid(redigest(missing), 'schema', '/coverage');
});

test('schema rejects invalid summary counts', () => {
  const base = receiptFor(checkReport());
  expectInvalid(redigest({ ...base, result: { ...base.result, summary: { ...base.result.summary, total: -1 } } }), 'schema', '/result/summary/total');
  expectInvalid(redigest({ ...base, result: { ...base.result, summary: { ...base.result.summary, passed: 1.5 } } }), 'schema', '/result/summary/passed');
  expectInvalid(redigest({ ...base, result: { ...base.result, summary: { ...base.result.summary, total: base.result.summary.total + 1 } } }), 'consistency', '/result/summary/total');
  const shifted = clone(base);
  shifted.result.summary.passed -= 1;
  shifted.result.summary.failed += 1;
  expectInvalid(redigest(shifted), 'consistency', '/result/summary');
});

test('consistency rules reject inconsistent verification metadata', () => {
  const check = receiptFor(checkReport());
  const verified = receiptFor(verifyReport('passed'));
  const blocked = receiptFor(verifyReport('blocked'));

  expectInvalid(redigest({ ...check, execution: { ...check.execution, verificationRequested: true } }), 'consistency', '/execution/verificationRequested');
  expectInvalid(redigest({ ...check, result: { ...check.result, verificationOutcome: 'passed' } }), 'consistency', '/result/verificationOutcome');
  expectInvalid(redigest({ ...check, execution: { ...check.execution, container: verified.execution.container } }), 'consistency', '/execution/container');
  expectInvalid(redigest({ ...blocked, result: { ...blocked.result, verificationOutcome: 'passed' } }), 'consistency', '/result/verificationOutcome');
  expectInvalid(redigest({ ...blocked, execution: { ...blocked.execution, repositoryCommandsEnvironment: 'controlled-docker' } }), 'consistency', '/execution/repositoryCommandsEnvironment');
  expectInvalid(redigest({ ...verified, execution: { ...verified.execution, verificationAuthorized: false } }), 'consistency', '/execution/repositoryCommandsExecuted');
  expectInvalid(redigest({ ...verified, execution: { ...verified.execution, repositoryCommandsEnvironment: 'none' } }), 'consistency', '/execution/repositoryCommandsEnvironment');
  expectInvalid(redigest({ ...verified, result: { ...verified.result, verificationOutcome: 'not_run' } }), 'consistency', '/result/verificationOutcome');
  expectInvalid(redigest({ ...verified, execution: { ...verified.execution, container: { ...verified.execution.container, imageDigest: `sha256:${'0'.repeat(64)}` } } }), 'consistency', '/execution/container/imageDigest');
  expectInvalid(redigest({ ...check, source: { ...check.source, revisionIdentity: 'unavailable' } }), 'consistency', '/source/revisionIdentity');
  expectInvalid(redigest({ ...check, tool: { ...check.tool, action: { repository: null, ref: null } } }), 'consistency', '/tool/action');
  expectInvalid(redigest({ ...check, environment: { ...check.environment, github: verified.environment.github || {
    repository: null, workflow: null, runId: null, runAttempt: null, eventName: null, ref: null, workflowCommit: null, runnerOs: null
  } } }), 'consistency', '/environment/github');
});

test('the shipped schema and the documented schema are identical', () => {
  const shipped = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'receipt', 'receipt-v1.schema.json'), 'utf8').replace(/\r\n/g, '\n');
  const documented = fs.readFileSync(path.join(PROJECT_ROOT, 'docs', 'schemas', 'receipt-v1.schema.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(documented, shipped);
  const schema = JSON.parse(shipped);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
});

test('the schema validator refuses unsupported keywords so no constraint is silently ignored', () => {
  assert.throws(() => compileSchema({ type: 'string', format: 'date-time' }), /Unsupported schema keyword "format"/);
  assert.throws(() => compileSchema({ type: 'object', additionalProperties: true }), /additionalProperties: false/);
  assert.throws(() => compileSchema({ $ref: '#/$defs/missing' })(1), /Unresolvable/);
});

test('documented example receipts validate and carry matching digests', () => {
  const examplesDirectory = path.join(PROJECT_ROOT, 'docs', 'examples');
  const examples = fs.readdirSync(examplesDirectory).filter((name) => /^receipt-.*\.json$/.test(name)).sort();
  assert.ok(examples.length >= 2, 'expected check and verify receipt examples');
  for (const name of examples) {
    const result = verifyReceiptContent(fs.readFileSync(path.join(examplesDirectory, name)));
    assert.equal(result.status, 'ok', `${name}: ${JSON.stringify(result.errors || result.message)}`);
  }
});

// ---------------------------------------------------------------------------
// Standalone verification
// ---------------------------------------------------------------------------

test('verifyReceiptContent distinguishes malformed, unsupported, schema, and digest failures', () => {
  const receipt = receiptFor(checkReport());
  const serialized = serializeReceipt(receipt);
  assert.equal(verifyReceiptContent(serialized).status, 'ok');
  assert.equal(verifyReceiptContent(Buffer.from(serialized)).status, 'ok');

  assert.equal(verifyReceiptContent('{not json').status, 'malformed');
  assert.equal(verifyReceiptContent(JSON.stringify({ ...receipt, receiptVersion: 2 })).status, 'unsupported');
  assert.equal(verifyReceiptContent(JSON.stringify({ ...receipt, receiptVersion: '1' })).status, 'unsupported');
  assert.equal(verifyReceiptContent('[]').status, 'invalid');
  assert.equal(verifyReceiptContent(' '.repeat(1024 * 1024 + 1)).status, 'too-large');

  const schemaBroken = verifyReceiptContent(JSON.stringify({ ...receipt, extra: 1 }));
  assert.equal(schemaBroken.status, 'invalid');
  assert.equal(schemaBroken.kind, 'schema');

  const tampered = clone(receipt);
  tampered.result.status = 'failed';
  const digestBroken = verifyReceiptContent(JSON.stringify(tampered));
  assert.equal(digestBroken.status, 'invalid');
  assert.equal(digestBroken.kind, 'digest');
  assert.equal(digestBroken.expected, receipt.integrity.digest);
  assert.notEqual(digestBroken.actual, receipt.integrity.digest);
});

test('a matching digest does not make inconsistent claims acceptable', () => {
  const receipt = receiptFor(verifyReport('blocked'));
  const forged = redigest({ ...receipt, result: { ...receipt.result, verificationOutcome: 'passed' } });
  assert.equal(verifyDigest(forged).valid, true);
  const result = verifyReceiptContent(JSON.stringify(forged));
  assert.equal(result.status, 'invalid');
  assert.equal(result.kind, 'consistency');
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('identical report and metadata produce byte-identical canonical payloads, digests, and files', () => {
  const first = receiptFor(verifyReport('passed'), { invocation: 'github-action', env: GITHUB_ENV });
  const second = receiptFor(verifyReport('passed'), { invocation: 'github-action', env: { ...GITHUB_ENV } });
  assert.equal(canonicalize(digestPayload(first)), canonicalize(digestPayload(second)));
  assert.equal(first.integrity.digest, second.integrity.digest);
  assert.equal(serializeReceipt(first), serializeReceipt(second));
});

test('a different generatedAt changes the receipt and digest', () => {
  const first = receiptFor(checkReport());
  const later = receiptFor(checkReport(), { now: () => new Date('2026-10-30T00:00:00.001Z') });
  assert.notEqual(first.integrity.digest, later.integrity.digest);
  assert.notEqual(serializeReceipt(first), serializeReceipt(later));
  assert.equal(canonicalize({ ...digestPayload(first), generatedAt: null }), canonicalize({ ...digestPayload(later), generatedAt: null }));
});

test('serialized receipts use sorted keys, LF newlines, and a trailing newline', () => {
  const serialized = serializeReceipt(receiptFor(checkReport()));
  assert.ok(serialized.endsWith('}\n'));
  assert.doesNotMatch(serialized, /\r/);
  const topLevelKeys = [...serialized.matchAll(/^ {2}"([A-Za-z]+)":/gm)].map((match) => match[1]);
  assert.deepEqual(topLevelKeys, [...topLevelKeys].sort());
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

function poisonedReport(kind) {
  const report = kind === 'check' ? checkReport() : verifyReport(kind);
  const tmp = os.tmpdir();
  const markers = [
    `GITHUB_TOKEN=${SECRET}`, `NPM_TOKEN=${SECRET}`, `PRIVATE_REGISTRY_PASSWORD=${SECRET}`, `.env=${SECRET}`,
    '/home/runner/work/private/repo', 'C:\\Users\\someone\\secret', '\\\\fileserver\\share\\secret', path.join(tmp, 'cloneproof-github-abc123'),
    'runner-host-01.internal', '10.1.2.3'
  ].join(' ');
  for (const finding of report.findings) {
    finding.message = `${finding.message} ${markers}`;
    finding.title = `${finding.title} ${markers}`;
    finding.recommendation = markers;
    finding.evidence = [{ path: markers, detail: markers, line: 1 }];
  }
  report.target.name = `${SECRET}-project`;
  report.scan = { ...(report.scan || {}), root: markers };
  report.project = { ...(report.project || {}), secretNote: markers };
  if (report.verification) {
    report.verification.stdout = `npm test output ${markers}`;
    report.verification.stderr = `npm ci output ${markers}`;
    report.verification.dockerExecutable = markers;
    report.verification.omittedPaths = ['.env', markers];
    report.verification.ignoredPaths = [markers];
    report.verification.cleanup.detail = markers;
    report.verification.cleanup.cleanupDirectory = markers;
    report.verification.commands = [markers];
  }
  return report;
}

const SECRET_ENV = {
  GITHUB_TOKEN: SECRET,
  ACTIONS_RUNTIME_TOKEN: SECRET,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: SECRET,
  NPM_TOKEN: SECRET,
  NODE_AUTH_TOKEN: SECRET,
  PRIVATE_REGISTRY_PASSWORD: SECRET,
  CLONEPROOF_GITHUB_TOKEN: SECRET,
  RUNNER_NAME: `${SECRET}-runner`,
  RUNNER_TEMP: `/home/runner/${SECRET}/_temp`,
  GITHUB_WORKSPACE: `/home/runner/work/${SECRET}`,
  HOSTNAME: `${SECRET}-host`,
  USER: `${SECRET}-user`,
  GITHUB_EVENT_PATH: `/home/runner/${SECRET}/event.json`,
  GITHUB_WORKFLOW: `/home/runner/${SECRET}/ci.yml`,
  GITHUB_REF: `refs/heads/${SECRET}=1`,
  GITHUB_ACTION_REF: `${SECRET} ref`,
  GITHUB_REPOSITORY: `${SECRET}/x/y`,
  GITHUB_RUN_ID: SECRET,
  GITHUB_EVENT_NAME: SECRET,
  GITHUB_SHA: SECRET
};

function assertNoLeaks(text, label) {
  const forbidden = [
    SECRET, '/home/runner', 'C:\\Users', 'C:\\\\Users', '\\\\fileserver', 'fileserver', 'runner-host-01', '10.1.2.3',
    'cloneproof-github-abc123', 'npm test output', 'npm ci output', os.hostname()
  ];
  const tmp = os.tmpdir();
  const home = os.homedir();
  for (const value of forbidden) {
    if (value && value.length >= 4) assert.ok(!text.includes(value), `${label} leaked ${value}`);
  }
  for (const value of [tmp, home, tmp.replace(/\\/g, '/'), home.replace(/\\/g, '/'), JSON.stringify(tmp).slice(1, -1)]) {
    assert.ok(!text.includes(value), `${label} leaked a host path`);
  }
  let username = '';
  try { username = os.userInfo().username; } catch { username = ''; }
  if (username.length >= 5) assert.ok(!text.includes(username), `${label} leaked the local username`);
}

test('no upstream report or environment pathway leaks secrets, paths, hostnames, or raw output', () => {
  for (const kind of ['check', 'passed', 'failed', 'blocked', 'timeout']) {
    for (const invocation of ['cli', 'github-action']) {
      const receipt = createReceipt({
        report: poisonedReport(kind),
        invocation,
        git: { commit: COMMIT, ref: `refs/heads/x=${SECRET}`, subdirectory: `/home/runner/${SECRET}`, checkoutRoot: `/home/runner/${SECRET}` },
        repository: `${SECRET}/../evil`,
        env: SECRET_ENV,
        now: FIXED_TIME
      });
      const serialized = serializeReceipt(receipt);
      assertNoLeaks(serialized, `${kind}/${invocation} receipt`);
      assertNoLeaks(canonicalize(digestPayload(receipt)), `${kind}/${invocation} canonical bytes`);
      assert.equal(validateReceipt(receipt).valid, true);
    }
  }
});

test('receipt and digest errors do not echo secret values', () => {
  const badCode = checkReport();
  badCode.findings[0].code = `CODE_${SECRET}=x`;
  const badStatus = checkReport();
  badStatus.findings[0].status = SECRET;
  const badSummary = checkReport();
  badSummary.summary.total = SECRET;
  const badCoverage = checkReport();
  badCoverage.coverage.checked = [SECRET];
  for (const report of [badCode, badStatus, badSummary, badCoverage]) {
    assert.throws(() => receiptFor(report), (error) => {
      assert.ok(!error.message.includes(SECRET), error.message);
      return true;
    });
  }

  const receipt = receiptFor(checkReport());
  const tampered = { ...receipt, [SECRET]: SECRET, result: { ...receipt.result, status: SECRET } };
  const result = verifyReceiptContent(JSON.stringify(tampered));
  assert.equal(result.status, 'invalid');
  assert.ok(!JSON.stringify(result).includes(`${SECRET}"`) || result.errors.every((error) => !error.message.includes(SECRET)));
  for (const error of result.errors) assert.ok(!error.message.includes(SECRET));
});

// ---------------------------------------------------------------------------
// Local Git metadata
// ---------------------------------------------------------------------------

test('local Git metadata is read from HEAD and loose refs without running git', () => withTempDir((directory) => {
  makeGitCheckout(directory);
  fs.mkdirSync(path.join(directory, 'packages', 'app'), { recursive: true });
  const root = readLocalGitMetadata(directory);
  assert.equal(root.commit, COMMIT);
  assert.equal(root.ref, 'refs/heads/main');
  assert.equal(root.subdirectory, '.');
  const nested = readLocalGitMetadata(path.join(directory, 'packages', 'app'));
  assert.equal(nested.commit, COMMIT);
  assert.equal(nested.subdirectory, 'packages/app');
}));

test('local Git metadata supports packed refs, detached HEAD, and worktree gitdir files', () => withTempDir((directory) => {
  const packed = path.join(directory, 'packed');
  fs.mkdirSync(packed);
  makeGitCheckout(packed, { packed: true, ref: 'refs/heads/feature/x' });
  assert.deepEqual(
    (({ commit, ref }) => ({ commit, ref }))(readLocalGitMetadata(packed)),
    { commit: COMMIT, ref: 'refs/heads/feature/x' }
  );

  const detached = path.join(directory, 'detached');
  fs.mkdirSync(detached);
  makeGitCheckout(detached, { detached: true, commit: OTHER_COMMIT });
  const detachedMetadata = readLocalGitMetadata(detached);
  assert.equal(detachedMetadata.commit, OTHER_COMMIT);
  assert.equal(detachedMetadata.ref, null);

  const common = path.join(directory, 'common');
  fs.mkdirSync(common);
  const commonGit = makeGitCheckout(common, { ref: 'refs/heads/main', commit: COMMIT });
  const worktreeGit = path.join(commonGit, 'worktrees', 'wt');
  fs.mkdirSync(worktreeGit, { recursive: true });
  fs.writeFileSync(path.join(worktreeGit, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(worktreeGit, 'commondir'), '../..\n');
  const worktree = path.join(directory, 'wt');
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${worktreeGit}\n`);
  assert.equal(readLocalGitMetadata(worktree).commit, COMMIT);
}));

test('unavailable or malformed Git metadata is reported as unavailable', () => withTempDir((directory) => {
  const none = path.join(directory, 'none');
  fs.mkdirSync(none);
  assert.equal(readLocalGitMetadata(none, { ceilingDirectory: none }).commit, null);

  const missingRef = path.join(directory, 'missing-ref');
  fs.mkdirSync(missingRef);
  makeGitCheckout(missingRef, { missingRef: true });
  const missing = readLocalGitMetadata(missingRef);
  assert.equal(missing.commit, null);
  assert.equal(missing.ref, null, 'a branch name without a resolvable commit is not recorded');

  const shortHead = path.join(directory, 'short');
  fs.mkdirSync(path.join(shortHead, '.git'), { recursive: true });
  fs.writeFileSync(path.join(shortHead, '.git', 'HEAD'), '0123456\n');
  assert.equal(readLocalGitMetadata(shortHead).commit, null);

  const traversal = path.join(directory, 'traversal');
  fs.mkdirSync(path.join(traversal, '.git'), { recursive: true });
  fs.writeFileSync(path.join(traversal, '.git', 'HEAD'), 'ref: refs/heads/../../../outside\n');
  assert.equal(readLocalGitMetadata(traversal).commit, null);

  const huge = path.join(directory, 'huge');
  fs.mkdirSync(path.join(huge, '.git'), { recursive: true });
  fs.writeFileSync(path.join(huge, '.git', 'HEAD'), `${COMMIT}\n${'x'.repeat(8192)}`);
  assert.equal(readLocalGitMetadata(huge).commit, null);

  const badGitFile = path.join(directory, 'bad-gitfile');
  fs.mkdirSync(badGitFile);
  fs.writeFileSync(path.join(badGitFile, '.git'), 'not a gitdir pointer');
  assert.equal(readLocalGitMetadata(badGitFile).commit, null);
}));

test('Git metadata search stops at the ceiling directory', () => withTempDir((directory) => {
  makeGitCheckout(directory);
  const child = path.join(directory, 'child');
  fs.mkdirSync(child);
  assert.equal(readLocalGitMetadata(child).commit, COMMIT);
  assert.equal(readLocalGitMetadata(child, { ceilingDirectory: child }).commit, null);
}));

test('Git metadata reading never executes repository-controlled configuration', () => withTempDir((directory) => {
  makeGitCheckout(directory);
  const sentinel = path.join(directory, 'sentinel');
  fs.writeFileSync(path.join(directory, '.git', 'config'), `[core]\n\tfsmonitor = node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, '/')}', 'x')"\n[alias]\n\trev-parse = !touch sentinel\n`);
  fs.mkdirSync(path.join(directory, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\ntouch sentinel\n');
  assert.equal(readLocalGitMetadata(directory).commit, COMMIT);
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(fs.existsSync(path.join(directory, 'sentinel')), false);
}));

// ---------------------------------------------------------------------------
// Atomic writing
// ---------------------------------------------------------------------------

test('atomic write replaces the destination and leaves no temporary files', () => withTempDir((directory) => {
  const destination = path.join(directory, 'receipt.json');
  fs.writeFileSync(destination, 'old');
  writeFileAtomic(destination, 'new content\n');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new content\n');
  assert.deepEqual(fs.readdirSync(directory), ['receipt.json']);
}));

test('atomic write failure leaves no partial receipt or temporary file', () => withTempDir((directory) => {
  const destinationDirectory = path.join(directory, 'receipt.json');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(path.join(destinationDirectory, 'keep'), 'x');
  assert.throws(() => writeFileAtomic(destinationDirectory, 'content'), (error) => error.code === 'RECEIPT_WRITE_FAILED' && !error.message.includes(directory));
  assert.deepEqual(fs.readdirSync(directory), ['receipt.json']);
  assert.deepEqual(fs.readdirSync(destinationDirectory), ['keep']);

  assert.throws(() => writeFileAtomic(path.join(directory, 'missing', 'receipt.json'), 'content'), (error) => error.code === 'RECEIPT_WRITE_FAILED');
  assert.deepEqual(fs.readdirSync(directory), ['receipt.json']);
}));

test('a receipt survives an atomic write and verifies from disk', () => withTempDir((directory) => {
  const destination = path.join(directory, 'receipt.json');
  const receipt = receiptFor(verifyReport('failed'));
  writeFileAtomic(destination, serializeReceipt(receipt));
  const result = verifyReceiptContent(fs.readFileSync(destination));
  assert.equal(result.status, 'ok');
  assert.equal(result.digest, receipt.integrity.digest);
}));

test('broken example produces a valid receipt with failed status', () => {
  const report = checkReport(BROKEN_EXAMPLE);
  const receipt = receiptFor(recompute(report));
  assert.equal(receipt.result.status, report.status);
  assert.equal(validateReceipt(receipt).valid, true);
});
