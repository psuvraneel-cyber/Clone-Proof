'use strict';

const path = require('node:path');
const { formatWorkflowCommand } = require('./workflow-commands');
const { isSubPath } = require('./paths');

const MAX_ANNOTATIONS = 50;
const MAX_TITLE_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 2048;

const STATUS_COMMAND_MAP = Object.freeze({
  failed: 'error',
  warning: 'warning',
  skipped: 'notice'
});

const STATUS_PRIORITY = Object.freeze({
  error: 1,
  warning: 2,
  notice: 3
});

/**
 * Resolves a finding's repository-relative path into a safe, normalized,
 * workspace-relative path using forward slashes.
 *
 * Returns null if the path is absent, absolute, malformed, or escapes
 * either targetRoot or workspaceRoot.
 */
function resolveAnnotationPath(rawPath, workspaceRoot, targetRoot) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (trimmed === '') return null;

  // Reject drive-prefixed paths (e.g. C:\...), UNC paths (\\... or //...), and absolute paths
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
    return null;
  }
  if (path.isAbsolute(trimmed)) {
    return null;
  }

  const resolved = path.resolve(targetRoot, trimmed);

  // Containment verification: must not escape targetRoot or workspaceRoot
  if (!isSubPath(targetRoot, resolved) || !isSubPath(workspaceRoot, resolved)) {
    return null;
  }

  const rel = path.relative(workspaceRoot, resolved);
  const normalized = rel.replace(/\\/g, '/');

  // Verify normalized path does not traverse upwards or start with absolute slash
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..') {
    return null;
  }

  return normalized === '' ? '.' : normalized;
}

/**
 * Extracts the primary file location, line, and column from a finding.
 */
function extractFindingLocation(finding, workspaceRoot, targetRoot) {
  let rawPath = null;
  let line = null;
  let col = null;

  if (typeof finding.path === 'string' && finding.path.trim() !== '') {
    rawPath = finding.path;
  } else if (Array.isArray(finding.evidence) && finding.evidence.length > 0) {
    for (const item of finding.evidence) {
      if (item && typeof item.path === 'string' && item.path.trim() !== '') {
        rawPath = item.path;
        if (Number.isInteger(item.line) && item.line > 0) line = item.line;
        if (Number.isInteger(item.column) && item.column > 0) col = item.column;
        else if (Number.isInteger(item.col) && item.col > 0) col = item.col;
        break;
      }
    }
  }

  if (Number.isInteger(finding.line) && finding.line > 0) {
    line = finding.line;
  }
  if (Number.isInteger(finding.column) && finding.column > 0) {
    col = finding.column;
  } else if (Number.isInteger(finding.col) && finding.col > 0) {
    col = finding.col;
  }

  const safeFile = rawPath ? resolveAnnotationPath(rawPath, workspaceRoot, targetRoot) : null;

  return {
    file: safeFile,
    line: safeFile ? line : null,
    col: safeFile ? col : null
  };
}

/**
 * Deterministic comparison for eligible annotations.
 * Priority: failed (error) > warning (warning) > skipped (notice)
 * Tie-breaker: file, line, col, title, message, original index.
 */
function compareAnnotations(left, right) {
  const prioLeft = STATUS_PRIORITY[left.command] || 99;
  const prioRight = STATUS_PRIORITY[right.command] || 99;
  if (prioLeft !== prioRight) return prioLeft - prioRight;

  const fileLeft = left.properties.file || '';
  const fileRight = right.properties.file || '';
  const fileCmp = fileLeft.localeCompare(fileRight);
  if (fileCmp !== 0) return fileCmp;

  const lineLeft = left.properties.line || 0;
  const lineRight = right.properties.line || 0;
  if (lineLeft !== lineRight) return lineLeft - lineRight;

  const colLeft = left.properties.col || 0;
  const colRight = right.properties.col || 0;
  if (colLeft !== colRight) return colLeft - colRight;

  const titleLeft = left.properties.title || '';
  const titleRight = right.properties.title || '';
  const titleCmp = titleLeft.localeCompare(titleRight);
  if (titleCmp !== 0) return titleCmp;

  const msgLeft = left.message || '';
  const msgRight = right.message || '';
  const msgCmp = msgLeft.localeCompare(msgRight);
  if (msgCmp !== 0) return msgCmp;

  return left.originalIndex - right.originalIndex;
}

/**
 * Prepares and sorts eligible annotations from a validated CloneProof report.
 */
function buildAnnotations(report, options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const targetRoot = options.targetRoot || workspaceRoot;
  const maxAnnotations = options.maxAnnotations || MAX_ANNOTATIONS;

  if (!report || !Array.isArray(report.findings)) {
    return { eligibleCount: 0, emitted: [], omittedCount: 0 };
  }

  const eligible = [];

  for (let index = 0; index < report.findings.length; index += 1) {
    const finding = report.findings[index];
    if (!finding || typeof finding !== 'object') continue;

    const command = STATUS_COMMAND_MAP[finding.status];
    if (!command) continue; // 'passed' or unknown statuses produce no annotation

    const { file, line, col } = extractFindingLocation(finding, workspaceRoot, targetRoot);

    let title = typeof finding.code === 'string' ? finding.code.trim() : '';
    if (title.length > MAX_TITLE_LENGTH) {
      title = title.slice(0, MAX_TITLE_LENGTH);
    }

    let message = typeof finding.message === 'string' && finding.message.trim() !== ''
      ? finding.message.trim()
      : (typeof finding.title === 'string' ? finding.title.trim() : title);
    if (message.length > MAX_MESSAGE_LENGTH) {
      message = `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
    }

    const properties = {};
    if (file) properties.file = file;
    if (line) properties.line = line;
    if (col) properties.col = col;
    if (title) properties.title = title;

    eligible.push({
      command,
      properties,
      message,
      originalIndex: index
    });
  }

  eligible.sort(compareAnnotations);

  const eligibleCount = eligible.length;
  const emitted = eligible.slice(0, maxAnnotations);
  const omittedCount = Math.max(0, eligibleCount - emitted.length);

  return {
    eligibleCount,
    emitted,
    omittedCount
  };
}

/**
 * Formats and emits workflow annotations to standard output or a designated destination.
 */
function emitAnnotations(report, options = {}) {
  const destination = options.destination || process.stdout;
  const result = buildAnnotations(report, options);

  const lines = [];

  for (const item of result.emitted) {
    const line = formatWorkflowCommand(item.command, item.properties, item.message);
    lines.push(line);
    if (destination && typeof destination.write === 'function') {
      destination.write(`${line}\n`);
    }
  }

  if (result.omittedCount > 0) {
    const diagnostic = formatWorkflowCommand(
      'notice',
      { title: 'Annotation limit reached' },
      `${result.omittedCount} additional findings were not emitted as workflow annotations. All findings remain available in the CloneProof JSON report and Job Summary.`
    );
    lines.push(diagnostic);
    if (destination && typeof destination.write === 'function') {
      destination.write(`${diagnostic}\n`);
    }
  }

  return {
    eligibleCount: result.eligibleCount,
    emittedCount: result.emitted.length,
    omittedCount: result.omittedCount,
    lines
  };
}

module.exports = {
  MAX_ANNOTATIONS,
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  STATUS_COMMAND_MAP,
  STATUS_PRIORITY,
  buildAnnotations,
  compareAnnotations,
  emitAnnotations,
  extractFindingLocation,
  resolveAnnotationPath
};
