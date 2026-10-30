'use strict';

// Shared fixtures for receipt tests. This file defines no tests.

const fs = require('node:fs');
const path = require('node:path');

const { scanRepository } = require('../src/scan/repository');
const { DEFAULT_VERIFY_IMAGE } = require('../src/verify/docker');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HEALTHY_EXAMPLE = path.join(PROJECT_ROOT, 'examples', 'healthy-node');
const BROKEN_EXAMPLE = path.join(PROJECT_ROOT, 'examples', 'broken-node');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const FIXED_TIME = new Date('2026-10-30T00:00:00.000Z');
const SECRET = 'TEST_SECRET_DO_NOT_LEAK';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recompute(report) {
  report.summary = {
    total: report.findings.length,
    passed: report.findings.filter((finding) => finding.status === 'passed').length,
    failed: report.findings.filter((finding) => finding.status === 'failed').length,
    warnings: report.findings.filter((finding) => finding.status === 'warning').length,
    skipped: report.findings.filter((finding) => finding.status === 'skipped').length
  };
  return report;
}

function checkReport(target = HEALTHY_EXAMPLE) {
  return clone(scanRepository(target));
}

function baseVerification(overrides = {}) {
  return {
    requested: true,
    authorized: true,
    image: DEFAULT_VERIFY_IMAGE,
    networkMode: 'none',
    networkConsent: false,
    timeoutMs: 300000,
    maxOutputBytes: 1048576,
    commands: ['copy the scanned repository snapshot into the container', 'npm ci --ignore-scripts', 'npm test'],
    outcome: 'passed',
    dockerAvailable: true,
    imageAvailable: true,
    dockerExecutable: 'docker',
    exitCode: 0,
    signal: null,
    failedPhase: null,
    timedOut: false,
    outputTruncated: false,
    noTestsRan: false,
    stdout: '',
    stderr: '',
    omittedPaths: [],
    ignoredPaths: [],
    ignoredPathCount: 0,
    ignoredPathsTruncated: false,
    cleanup: { attempted: true, completed: true, stagingRemoved: true, clientConfigRemoved: true, stagingAttempted: true },
    ...overrides
  };
}

function verifyReport(kind = 'passed') {
  const report = checkReport();
  report.mode = 'verify';
  if (kind === 'passed') {
    report.verification = baseVerification();
    report.findings.push({
      code: 'DOCKER_VERIFICATION_PASSED', status: 'passed', severity: 'info', title: 'Docker verification passed',
      message: 'npm ci and npm test passed.', evidence: [], recommendation: 'Keep it reproducible.'
    });
    report.status = 'passed';
  } else if (kind === 'failed') {
    report.verification = baseVerification({ outcome: 'failed', exitCode: 1, failedPhase: 'test', stderr: 'test output' });
    report.findings.push({
      code: 'DOCKER_VERIFICATION_FAILED', status: 'failed', severity: 'error', title: 'Docker verification failed',
      message: 'npm test failed.', evidence: [], recommendation: 'Fix the tests.'
    });
    report.status = 'failed';
  } else if (kind === 'blocked') {
    report.verification = baseVerification({
      outcome: 'blocked', exitCode: null, dockerAvailable: false, imageAvailable: false,
      cleanup: { attempted: false, completed: true, stagingRemoved: false, clientConfigRemoved: true, stagingAttempted: false }
    });
    report.findings.push({
      code: 'DOCKER_UNAVAILABLE', status: 'skipped', severity: 'warning', title: 'Docker is unavailable',
      message: 'Docker could not be reached.', evidence: [], recommendation: 'Start Docker.'
    });
    report.status = 'blocked';
  } else if (kind === 'unauthorized') {
    report.verification = baseVerification({
      authorized: false, outcome: 'blocked', exitCode: null,
      cleanup: { attempted: false, completed: true, stagingRemoved: false, clientConfigRemoved: false, stagingAttempted: false }
    });
    report.findings.push({
      code: 'DOCKER_EXECUTION_CONSENT_REQUIRED', status: 'skipped', severity: 'warning', title: 'Not authorized',
      message: 'Consent required.', evidence: [], recommendation: 'Authorize.'
    });
    report.status = 'blocked';
  } else if (kind === 'timeout') {
    report.verification = baseVerification({ outcome: 'failed', exitCode: null, timedOut: true, failedPhase: 'test' });
    report.findings.push({
      code: 'DOCKER_VERIFICATION_FAILED', status: 'failed', severity: 'error', title: 'Docker verification failed',
      message: 'Timed out.', evidence: [], recommendation: 'Investigate.'
    });
    report.status = 'failed';
  }
  return recompute(report);
}

/**
 * Create a minimal on-disk Git checkout (HEAD + ref) without running git.
 */
function makeGitCheckout(root, options = {}) {
  const gitDirectory = path.join(root, '.git');
  fs.mkdirSync(gitDirectory, { recursive: true });
  const ref = options.ref === undefined ? 'refs/heads/main' : options.ref;
  const commit = options.commit || COMMIT;
  if (options.detached) {
    fs.writeFileSync(path.join(gitDirectory, 'HEAD'), `${commit}\n`);
    return gitDirectory;
  }
  fs.writeFileSync(path.join(gitDirectory, 'HEAD'), `ref: ${ref}\n`);
  if (options.packed) {
    fs.writeFileSync(path.join(gitDirectory, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${commit} ${ref}\n^${OTHER_COMMIT}\n`);
  } else if (!options.missingRef) {
    const refPath = path.join(gitDirectory, ...ref.split('/'));
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, `${commit}\n`);
  }
  return gitDirectory;
}

function copyExample(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

module.exports = {
  BROKEN_EXAMPLE,
  COMMIT,
  FIXED_TIME,
  HEALTHY_EXAMPLE,
  OTHER_COMMIT,
  PROJECT_ROOT,
  SECRET,
  checkReport,
  clone,
  copyExample,
  makeGitCheckout,
  recompute,
  verifyReport
};
