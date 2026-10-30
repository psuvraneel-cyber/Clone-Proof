'use strict';

const { version: PACKAGE_VERSION } = require('../../package.json');
const { CHECK_GROUP_IDS, NOT_CHECKED } = require('../report/coverage');
const { attachIntegrity, verifyDigest } = require('./digest');
const { assertValidReceipt } = require('./validate');

const RECEIPT_VERSION = 1;
const RECEIPT_TYPE = 'cloneproof.reproducibility';
const RECEIPT_GENERATOR_VERSION = 1;
const REPORT_SCHEMA_VERSION = 2;

const REPORT_STATUSES = new Set(['passed', 'passed_with_warnings', 'failed', 'blocked', 'incomplete']);
const FINDING_STATUSES = new Set(['passed', 'failed', 'warning', 'skipped']);
const VERIFICATION_OUTCOMES = new Set(['passed', 'failed', 'blocked']);
const NETWORK_POLICIES = new Set(['none', 'bridge']);
const RUNNER_OS_VALUES = new Set(['Linux', 'Windows', 'macOS']);
const KNOWN_COVERAGE_IDS = new Set([...CHECK_GROUP_IDS, ...NOT_CHECKED]);

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const GIT_REF = /^(?!.*\.\.)(?!.*\/\/)(?!.*\/$)refs\/(?:heads|tags|remotes|pull)\/[A-Za-z0-9._/+-]{1,240}$/;
const SUBDIRECTORY = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const ACTION_REF = /^[A-Za-z0-9._/-]{1,128}$/;
const IMAGE = /^[a-z0-9][a-z0-9._/:-]{0,230}(?:@sha256:[0-9a-f]{64})?$/;
const FINDING_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const NODE_VERSION = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const EVENT_NAME = /^[a-z_]{1,64}$/;
const RUN_ID = /^[0-9]{1,20}$/;
const RUN_ATTEMPT = /^[0-9]{1,4}$/;
const WORKFLOW_NAME = /^[^\u0000-\u001f\u007f]{1,128}$/u;
const ABSOLUTE_PATH = /^(?:\/|\\|[A-Za-z]:[\\/])/;

function receiptError(message) {
  const error = new Error(message);
  error.code = 'RECEIPT_GENERATION_FAILED';
  return error;
}

/** Return value when it is a string matching pattern, otherwise null. */
function matching(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertReport(report) {
  if (!isObject(report)) throw receiptError('Report must be a JSON object.');
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) throw receiptError('Report schemaVersion must be 2.');
  if (report.tool !== 'cloneproof') throw receiptError('Report tool identifier must be "cloneproof".');
  if (report.mode !== 'check' && report.mode !== 'verify') throw receiptError('Report mode must be "check" or "verify".');
  if (!REPORT_STATUSES.has(report.status)) throw receiptError('Report status is not a recognized value.');
  if (!Array.isArray(report.findings)) throw receiptError('Report findings must be an array.');
  if (!isObject(report.summary)) throw receiptError('Report summary must be an object.');
  if (!isObject(report.target) || (report.target.kind !== 'local' && report.target.kind !== 'github')) {
    throw receiptError('Report target kind must be "local" or "github".');
  }
  if (!isObject(report.coverage)) throw receiptError('Report coverage must be an object.');
}

function formatTimestamp(now) {
  const date = typeof now === 'function' ? now() : now;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw receiptError('Receipt clock returned an invalid date.');
  return date.toISOString();
}

function buildSource(report, options) {
  const target = report.target;
  if (target.kind === 'github') {
    const repository = matching(target.name, REPOSITORY);
    const url = repository && target.url === `https://github.com/${repository}` ? target.url : null;
    const commit = matching(target.commit, FULL_SHA);
    return {
      kind: 'github',
      repository,
      url,
      commit: commit ? commit.toLowerCase() : null,
      ref: null,
      subdirectory: commit ? '.' : null,
      revisionIdentity: commit ? 'commit' : 'unavailable',
      identitySource: commit ? 'cloneproof-github-clone' : 'none'
    };
  }

  const git = isObject(options.git) ? options.git : {};
  const commit = matching(git.commit, FULL_SHA);
  const repository = matching(options.repository, REPOSITORY);
  const subdirectory = git.subdirectory === '.' ? '.' : matching(git.subdirectory, SUBDIRECTORY);
  return {
    kind: 'local',
    repository,
    url: repository ? `https://github.com/${repository}` : null,
    commit: commit ? commit.toLowerCase() : null,
    ref: commit ? matching(git.ref, GIT_REF) : null,
    subdirectory: commit ? subdirectory : null,
    revisionIdentity: commit ? 'commit' : 'unavailable',
    identitySource: commit ? 'local-git-metadata' : 'none'
  };
}

function buildTool(options, invocation, env) {
  const version = matching(options.packageVersion === undefined ? PACKAGE_VERSION : options.packageVersion, SEMVER);
  if (!version) throw receiptError('CloneProof package version is not a valid semantic version.');
  return {
    name: 'cloneproof',
    version,
    receiptGeneratorVersion: RECEIPT_GENERATOR_VERSION,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    action: invocation === 'github-action'
      ? {
        repository: matching(env.GITHUB_ACTION_REPOSITORY, REPOSITORY),
        ref: matching(env.GITHUB_ACTION_REF, ACTION_REF)
      }
      : null
  };
}

function containerFor(verification) {
  if (!isObject(verification)) return null;
  const image = matching(verification.image, IMAGE);
  const timeoutMs = Number.isInteger(verification.timeoutMs) && verification.timeoutMs >= 1 && verification.timeoutMs <= 86400000
    ? verification.timeoutMs
    : null;
  return {
    image,
    imageDigest: image && image.includes('@') ? image.slice(image.indexOf('@') + 1) : null,
    networkPolicy: NETWORK_POLICIES.has(verification.networkMode) ? verification.networkMode : null,
    timeoutMs
  };
}

/**
 * Repository commands are recorded as executed only when the report carries
 * evidence that the controlled container ran: a container exit code, a
 * timeout, or a terminating signal. Blocked or unauthorized runs never count.
 */
function commandsExecuted(verification) {
  if (!isObject(verification) || verification.authorized !== true) return false;
  return Number.isInteger(verification.exitCode)
    || verification.timedOut === true
    || (typeof verification.signal === 'string' && verification.signal.length > 0);
}

function buildExecution(report, invocation) {
  const verify = report.mode === 'verify';
  const verification = verify && isObject(report.verification) ? report.verification : null;
  const executed = commandsExecuted(verification);
  return {
    invocation,
    mode: report.mode,
    verificationRequested: verify,
    verificationAuthorized: Boolean(verification && verification.authorized === true),
    repositoryCommandsExecuted: executed,
    repositoryCommandsEnvironment: executed ? 'controlled-docker' : 'none',
    container: containerFor(verification)
  };
}

function githubMetadata(env) {
  const workflow = matching(env.GITHUB_WORKFLOW, WORKFLOW_NAME);
  const runAttempt = matching(env.GITHUB_RUN_ATTEMPT, RUN_ATTEMPT);
  const workflowCommit = matching(env.GITHUB_SHA, FULL_SHA);
  return {
    repository: matching(env.GITHUB_REPOSITORY, REPOSITORY),
    workflow: workflow && !ABSOLUTE_PATH.test(workflow) ? workflow : null,
    runId: matching(env.GITHUB_RUN_ID, RUN_ID),
    runAttempt: runAttempt && Number(runAttempt) >= 1 && Number(runAttempt) <= 1000 ? Number(runAttempt) : null,
    eventName: matching(env.GITHUB_EVENT_NAME, EVENT_NAME),
    ref: matching(env.GITHUB_REF, GIT_REF),
    workflowCommit: workflowCommit ? workflowCommit.toLowerCase() : null,
    runnerOs: RUNNER_OS_VALUES.has(env.RUNNER_OS) ? env.RUNNER_OS : null
  };
}

function buildEnvironment(options, invocation, env) {
  const inGithub = invocation === 'github-action' || env.GITHUB_ACTIONS === 'true';
  const runnerEnvironment = env.RUNNER_ENVIRONMENT;
  const nodeVersion = matching(options.nodeVersion || process.version, NODE_VERSION);
  if (!nodeVersion) throw receiptError('Node.js version is not in the expected vX.Y.Z form.');
  return {
    runner: !inGithub
      ? 'local'
      : (runnerEnvironment === 'github-hosted' || runnerEnvironment === 'self-hosted' ? runnerEnvironment : 'github-actions'),
    os: options.platform || process.platform,
    arch: options.arch || process.arch,
    nodeVersion,
    github: inGithub ? githubMetadata(env) : null
  };
}

function verificationOutcome(report) {
  if (report.mode !== 'verify') return 'not_run';
  const verification = report.verification;
  return isObject(verification) && VERIFICATION_OUTCOMES.has(verification.outcome) ? verification.outcome : 'error';
}

function cleanupOutcome(report) {
  const target = report.target;
  const cleanup = report.mode === 'verify' && isObject(report.verification) && isObject(report.verification.cleanup)
    ? report.verification.cleanup
    : null;
  if (target.cleanupFailed === true || (cleanup && cleanup.cleanupFailed === true)) return 'failed';
  if (cleanup) return cleanup.completed === true ? 'confirmed' : 'incomplete';
  return target.kind === 'github' ? 'confirmed' : 'not_applicable';
}

function count(value, name) {
  if (!Number.isInteger(value) || value < 0) throw receiptError(`Report summary.${name} must be a non-negative integer.`);
  return value;
}

function buildResult(report) {
  const findings = report.findings.map((finding, index) => {
    if (!isObject(finding) || !FINDING_CODE.test(finding.code) || !FINDING_STATUSES.has(finding.status)) {
      throw receiptError(`Report finding ${index} has an invalid code or status.`);
    }
    return { code: finding.code, status: finding.status };
  });
  const summary = {
    total: count(report.summary.total, 'total'),
    passed: count(report.summary.passed, 'passed'),
    failed: count(report.summary.failed, 'failed'),
    warnings: count(report.summary.warnings, 'warnings'),
    skipped: count(report.summary.skipped, 'skipped')
  };
  const tally = { passed: 0, failed: 0, warning: 0, skipped: 0 };
  for (const finding of findings) tally[finding.status] += 1;
  if (summary.total !== findings.length || summary.passed !== tally.passed || summary.failed !== tally.failed
    || summary.warnings !== tally.warning || summary.skipped !== tally.skipped) {
    throw receiptError('Report summary is inconsistent with its findings.');
  }
  return {
    status: report.status,
    verificationOutcome: verificationOutcome(report),
    summary,
    findings,
    cleanup: cleanupOutcome(report)
  };
}

function coverageIds(value, name) {
  if (!Array.isArray(value)) throw receiptError(`Report coverage.${name} must be an array.`);
  for (const id of value) {
    if (!KNOWN_COVERAGE_IDS.has(id)) throw receiptError(`Report coverage.${name} contains an unknown group.`);
  }
  return [...value];
}

/**
 * Build a receipt from an already-finalized report. The report is read, never
 * modified, and nothing is scanned or executed.
 *
 * @param {object} options
 * @param {object} options.report  validated CloneProof report (schema v2)
 * @param {'cli'|'github-action'} options.invocation
 * @param {object} [options.git]  result of readLocalGitMetadata for local targets
 * @param {string} [options.repository]  owner/name for a local checkout, when trusted
 * @param {object} [options.env]  environment variables (only allow-listed keys are read)
 * @param {Date|function(): Date} [options.now]  injectable clock
 */
function createReceipt(options = {}) {
  const { report } = options;
  assertReport(report);
  const invocation = options.invocation;
  if (invocation !== 'cli' && invocation !== 'github-action') throw receiptError('Invocation must be "cli" or "github-action".');
  const env = isObject(options.env) ? options.env : {};

  const payload = {
    receiptVersion: RECEIPT_VERSION,
    receiptType: RECEIPT_TYPE,
    generatedAt: formatTimestamp(options.now === undefined ? new Date() : options.now),
    source: buildSource(report, options),
    tool: buildTool(options, invocation, env),
    execution: buildExecution(report, invocation),
    environment: buildEnvironment(options, invocation, env),
    result: buildResult(report),
    coverage: {
      checked: coverageIds(report.coverage.checked, 'checked'),
      notChecked: coverageIds(report.coverage.notChecked, 'notChecked')
    }
  };

  const receipt = attachIntegrity(payload);
  assertValidReceipt(receipt);
  if (!verifyDigest(receipt).valid) throw receiptError('Receipt digest self-check failed.');
  return receipt;
}

module.exports = {
  RECEIPT_GENERATOR_VERSION,
  RECEIPT_TYPE,
  RECEIPT_VERSION,
  createReceipt
};
