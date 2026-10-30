'use strict';

const { compileSchema } = require('./json-schema');
const { verifyDigest } = require('./digest');
const RECEIPT_V1_SCHEMA = require('./receipt-v1.schema.json');

const SUPPORTED_RECEIPT_VERSION = 1;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const validateSchema = compileSchema(RECEIPT_V1_SCHEMA);

const ABSOLUTE_PATH_PATTERN = /^(?:\/|\\|[A-Za-z]:[\\/])/;

/**
 * Cross-field rules a JSON Schema cannot express cleanly. Each returns a
 * fixed message so untrusted receipt content never reaches diagnostics.
 */
function semanticErrors(receipt) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  const { source, execution, environment, result } = receipt;

  if ((source.commit !== null) !== (source.revisionIdentity === 'commit')) {
    add('/source/revisionIdentity', 'must be "commit" exactly when a commit SHA is recorded');
  }
  if (source.commit === null && source.identitySource !== 'none') {
    add('/source/identitySource', 'must be "none" when no commit SHA is recorded');
  }
  if (source.commit !== null && source.identitySource === 'none') {
    add('/source/identitySource', 'must name where the recorded commit SHA came from');
  }
  if (source.identitySource === 'cloneproof-github-clone' && source.kind !== 'github') {
    add('/source/identitySource', 'cloneproof-github-clone requires a GitHub source');
  }
  if (source.kind === 'github' && source.repository === null && source.url !== null) {
    add('/source/repository', 'is required when a GitHub URL is recorded');
  }
  if (source.url !== null && source.repository !== null && source.url !== `https://github.com/${source.repository}`) {
    add('/source/url', 'must be the canonical URL of the recorded repository');
  }

  if (execution.mode === 'check') {
    if (execution.verificationRequested) add('/execution/verificationRequested', 'must be false in check mode');
    if (execution.verificationAuthorized) add('/execution/verificationAuthorized', 'must be false in check mode');
    if (execution.container !== null) add('/execution/container', 'must be null in check mode');
    if (result.verificationOutcome !== 'not_run') add('/result/verificationOutcome', 'must be "not_run" in check mode');
  } else {
    if (!execution.verificationRequested) add('/execution/verificationRequested', 'must be true in verify mode');
    if (result.verificationOutcome === 'not_run') add('/result/verificationOutcome', 'must not be "not_run" in verify mode');
  }
  if (execution.verificationAuthorized && !execution.verificationRequested) {
    add('/execution/verificationAuthorized', 'requires verificationRequested');
  }
  if (execution.repositoryCommandsExecuted) {
    if (!execution.verificationAuthorized) add('/execution/repositoryCommandsExecuted', 'requires authorized verification');
    if (execution.repositoryCommandsEnvironment !== 'controlled-docker') {
      add('/execution/repositoryCommandsEnvironment', 'must be "controlled-docker" when repository commands ran');
    }
    if (execution.container === null) add('/execution/container', 'is required when repository commands ran');
    if (!['passed', 'failed', 'blocked'].includes(result.verificationOutcome)) {
      add('/result/verificationOutcome', 'must be passed, failed, or blocked when repository commands ran');
    }
  } else if (execution.repositoryCommandsEnvironment !== 'none') {
    add('/execution/repositoryCommandsEnvironment', 'must be "none" when no repository commands ran');
  }
  if (result.verificationOutcome === 'passed' && !execution.repositoryCommandsExecuted) {
    add('/result/verificationOutcome', 'cannot be "passed" unless repository commands ran');
  }
  if (execution.container !== null) {
    const { image, imageDigest } = execution.container;
    const embedded = typeof image === 'string' && image.includes('@') ? image.slice(image.indexOf('@') + 1) : null;
    if (embedded !== imageDigest) add('/execution/container/imageDigest', 'must equal the digest pinned in the image reference');
  }

  const summary = result.summary;
  if (summary.total !== summary.passed + summary.failed + summary.warnings + summary.skipped) {
    add('/result/summary/total', 'must equal the sum of the status counts');
  }
  if (result.findings.length !== summary.total) {
    add('/result/findings', 'must contain exactly summary.total entries');
  }
  const counted = { passed: 0, failed: 0, warning: 0, skipped: 0 };
  for (const finding of result.findings) counted[finding.status] += 1;
  if (counted.passed !== summary.passed || counted.failed !== summary.failed
    || counted.warning !== summary.warnings || counted.skipped !== summary.skipped) {
    add('/result/summary', 'must match the finding status projection');
  }

  const checked = new Set(receipt.coverage.checked);
  if (receipt.coverage.notChecked.some((id) => checked.has(id))) {
    add('/coverage', 'a group cannot be both checked and not checked');
  }

  const generatedAt = new Date(receipt.generatedAt);
  if (Number.isNaN(generatedAt.getTime()) || generatedAt.toISOString() !== receipt.generatedAt) {
    add('/generatedAt', 'must be a valid UTC timestamp');
  }

  if (environment.runner === 'local' && environment.github !== null) {
    add('/environment/github', 'must be null for a local runner');
  }
  if (environment.runner !== 'local' && environment.github === null) {
    add('/environment/github', 'is required for a GitHub Actions runner');
  }
  if (environment.github && environment.github.workflow !== null && ABSOLUTE_PATH_PATTERN.test(environment.github.workflow)) {
    add('/environment/github/workflow', 'must not be an absolute path');
  }
  if (execution.invocation === 'github-action' && environment.runner === 'local') {
    add('/environment/runner', 'cannot be local for a GitHub Action invocation');
  }
  if (execution.invocation === 'cli' && receipt.tool.action !== null) {
    add('/tool/action', 'must be null for a CLI invocation');
  }

  return errors;
}

/**
 * Validate structure and semantics (not the digest).
 */
function validateReceipt(receipt) {
  const schemaResult = validateSchema(receipt);
  if (!schemaResult.valid) return { valid: false, kind: 'schema', errors: schemaResult.errors };
  const semantic = semanticErrors(receipt);
  if (semantic.length > 0) return { valid: false, kind: 'consistency', errors: semantic };
  return { valid: true, kind: null, errors: [] };
}

function assertValidReceipt(receipt) {
  const outcome = validateReceipt(receipt);
  if (!outcome.valid) {
    const first = outcome.errors[0];
    const error = new Error(`Receipt failed ${outcome.kind} validation at ${first.path || '/'}: ${first.message}`);
    error.code = 'RECEIPT_INVALID';
    error.errors = outcome.errors;
    throw error;
  }
  return receipt;
}

/**
 * Verify serialized receipt content. Returns a classified result:
 * - ok: schema, consistency, and digest checks passed (exit 0)
 * - invalid: JSON parsed but schema/consistency/digest failed (exit 1)
 * - unsupported / malformed / too-large: cannot be evaluated (exit 2)
 */
function verifyReceiptContent(content) {
  const byteLength = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content), 'utf8');
  if (byteLength > MAX_RECEIPT_BYTES) {
    return { status: 'too-large', message: `Receipt exceeds the ${MAX_RECEIPT_BYTES}-byte limit.` };
  }
  let receipt;
  try {
    receipt = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : String(content));
  } catch {
    return { status: 'malformed', message: 'Receipt is not valid JSON.' };
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { status: 'invalid', kind: 'schema', message: 'Receipt must be a JSON object.', errors: [] };
  }
  if (receipt.receiptVersion !== SUPPORTED_RECEIPT_VERSION) {
    return {
      status: 'unsupported',
      message: Number.isInteger(receipt.receiptVersion) && receipt.receiptVersion > 0 && receipt.receiptVersion < 1000
        ? `Unsupported receiptVersion ${receipt.receiptVersion}; this CloneProof supports version ${SUPPORTED_RECEIPT_VERSION}.`
        : `Missing or invalid receiptVersion; this CloneProof supports version ${SUPPORTED_RECEIPT_VERSION}.`
    };
  }
  const structural = validateReceipt(receipt);
  if (!structural.valid) {
    return {
      status: 'invalid',
      kind: structural.kind,
      message: `Receipt failed ${structural.kind} validation.`,
      errors: structural.errors
    };
  }
  const digest = verifyDigest(receipt);
  if (!digest.valid) {
    return {
      status: 'invalid',
      kind: 'digest',
      message: 'Recorded integrity digest does not match the recomputed canonical SHA-256 digest.',
      errors: [{ path: '/integrity/digest', message: digest.reason }],
      expected: digest.expected,
      actual: digest.actual
    };
  }
  return { status: 'ok', receipt, digest: digest.actual };
}

module.exports = {
  MAX_RECEIPT_BYTES,
  RECEIPT_V1_SCHEMA,
  SUPPORTED_RECEIPT_VERSION,
  assertValidReceipt,
  validateReceipt,
  verifyReceiptContent
};
