'use strict';

const ANSI = Object.freeze({
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[36m',
  gray: '\u001b[90m'
});

const STATUS_MARKERS = Object.freeze({
  passed: { label: 'PASS', color: ANSI.green },
  failed: { label: 'FAIL', color: ANSI.red },
  warning: { label: 'WARN', color: ANSI.yellow },
  skipped: { label: 'SKIP', color: ANSI.gray },
  blocked: { label: 'BLOCKED', color: ANSI.yellow },
  incomplete: { label: 'INCOMPLETE', color: ANSI.yellow },
  unknown: { label: 'UNKNOWN', color: ANSI.gray }
});

/**
 * Return a JSON-compatible value with object keys in a canonical order.
 * Arrays retain their report order because finding order is meaningful to a
 * person reading a report.
 */
function canonicalize(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      throw new TypeError('Cannot render a circular report as JSON');
    }
    seen.add(value);

    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key], seen);
    }

    seen.delete(value);
    return result;
  }

  return value;
}

/**
 * Render a report as canonical, human-diffable JSON.
 *
 * @param {unknown} report
 * @returns {string}
 */
function renderJson(report) {
  const json = JSON.stringify(canonicalize(report), null, 2);
  return `${json === undefined ? 'null' : json}\n`;
}

function normalizeStatus(value) {
  if (value === null || value === undefined) {
    return 'unknown';
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized || 'unknown';
}

function reportStatus(report) {
  if (!report || typeof report !== 'object') {
    return 'unknown';
  }

  return report.status ?? 'unknown';
}

function findingsFor(report) {
  if (!report || typeof report !== 'object') {
    return [];
  }

  return Array.isArray(report.findings) ? report.findings : [];
}

function statusValueForFinding(finding) {
  if (!finding || typeof finding !== 'object') {
    return 'unknown';
  }

  return finding.status ?? 'unknown';
}

function derivedCounts(findings) {
  const counts = {
    total: findings.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0
  };

  for (const finding of findings) {
    switch (normalizeStatus(statusValueForFinding(finding))) {
      case 'passed':
        counts.passed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'warning':
        counts.warnings += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function reportCounts(report, findings) {
  const derived = derivedCounts(findings);
  const summary = report && report.summary && typeof report.summary === 'object'
    ? report.summary
    : {};
  return {
    total: summary.total ?? derived.total,
    passed: summary.passed ?? derived.passed,
    failed: summary.failed ?? derived.failed,
    warnings: summary.warnings ?? derived.warnings,
    skipped: summary.skipped ?? derived.skipped
  };
}

function textValue(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.map((item) => textValue(item)).join(', ');
  }

  if (typeof value === 'object') {
    try {
      return renderJson(value).trim();
    } catch {
      return '[unserializable value]';
    }
  }

  return String(value);
}

/**
 * Escape C0/C1 controls and DEL so report data cannot inject terminal
 * commands or extra terminal lines. Normal renderer line breaks are added
 * separately below.
 */
function escapeControlCharacters(value) {
  return textValue(value).replace(/[\u0000-\u001f\u007f\u0080-\u009f]/g, (character) => {
    switch (character) {
      case '\b':
        return '\\b';
      case '\t':
        return '\\t';
      case '\n':
        return '\\n';
      case '\f':
        return '\\f';
      case '\r':
        return '\\r';
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
}

function colorEnabled(options) {
  if (options && options.color === false) {
    return false;
  }

  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const isTTY = options && options.isTTY !== undefined
    ? Boolean(options.isTTY)
    : Boolean(process.stdout && process.stdout.isTTY);

  return isTTY;
}

function paint(value, color, enabled) {
  if (!enabled || !color) {
    return value;
  }

  return `${color}${value}${ANSI.reset}`;
}

function targetName(report) {
  if (!report || typeof report !== 'object') {
    return 'unknown';
  }

  const target = report.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return textValue(target.name, 'unknown');
  }

  return 'unknown';
}

function findingText(finding, key, fallback = '') {
  if (!finding || typeof finding !== 'object') {
    return fallback;
  }

  return textValue(finding[key], fallback);
}

function evidenceItems(finding) {
  if (!finding || typeof finding !== 'object') {
    return [];
  }

  let evidence = finding.evidence ?? [];

  if (!Array.isArray(evidence)) {
    evidence = [evidence];
  }

  return evidence;
}

function lineValue(item) {
  if (!item || typeof item !== 'object') {
    return undefined;
  }

  return item.line === undefined ? undefined : textValue(item.line);
}

function evidenceText(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return escapeControlCharacters(item);
  }

  if (!item || typeof item !== 'object') {
    return '';
  }

  const path = item.path;
  const line = lineValue(item);
  const detail = escapeControlCharacters(item.detail || '');

  if (path === undefined && line === undefined) {
    return detail;
  }

  const renderedPath = path === undefined ? 'unknown path' : escapeControlCharacters(path);
  const location = line === undefined ? renderedPath : `${renderedPath}:${escapeControlCharacters(line)}`;
  return detail ? `${location} — ${detail}` : location;
}

function renderFinding(finding, enabled) {
  const normalizedStatus = normalizeStatus(statusValueForFinding(finding));
  const marker = STATUS_MARKERS[normalizedStatus] || STATUS_MARKERS.unknown;
  const code = escapeControlCharacters(findingText(finding, 'code', 'UNKNOWN'));
  const title = escapeControlCharacters(findingText(finding, 'title', 'Untitled finding'));
  const message = escapeControlCharacters(
    findingText(finding, 'message', 'No message provided')
  );
  const recommendation = escapeControlCharacters(
    findingText(finding, 'recommendation', 'No recommendation provided')
  );
  const lines = [
    `${paint(`[${marker.label}]`, marker.color, enabled)} ${code} — ${title}`,
    `  Message: ${message}`
  ];

  const evidence = evidenceItems(finding)
    .map(evidenceText)
    .filter((item) => item.length > 0);
  if (evidence.length > 0) {
    lines.push('  Evidence:');
    for (const item of evidence) {
      lines.push(`    - ${item}`);
    }
  }

  lines.push(`  Recommendation: ${recommendation}`);
  return lines;
}

const MAX_VERIFICATION_OUTPUT_LINES = 60;
const MAX_VERIFICATION_OUTPUT_CHARS = 4000;

function boundedOutputLines(value) {
  const rawLines = String(value).split(/\r?\n/);
  if (rawLines.at(-1) === '') rawLines.pop();
  const selected = rawLines.slice(-MAX_VERIFICATION_OUTPUT_LINES).map(escapeControlCharacters);
  let output = selected.join('\n');
  if (output.length > MAX_VERIFICATION_OUTPUT_CHARS) {
    output = `…${output.slice(-(MAX_VERIFICATION_OUTPUT_CHARS - 1))}`;
  }
  return output ? output.split('\n') : [];
}

function verificationLines(report) {
  if (!report || !report.verification || typeof report.verification !== 'object') {
    return [];
  }

  const verification = report.verification;
  const lines = [
    '',
    'Docker verification:',
    `  Outcome: ${escapeControlCharacters(verification.outcome || 'unknown')}`,
    `  Image: ${escapeControlCharacters(verification.image || 'unknown')}`,
    `  Network: ${escapeControlCharacters(verification.networkMode || 'unknown')}${verification.networkConsent ? ' (explicitly allowed)' : ' (disabled by default)'}`,
    `  Exit code: ${escapeControlCharacters(verification.exitCode === null || verification.exitCode === undefined ? 'n/a' : verification.exitCode)}`,
    `  Cleanup complete: ${verification.cleanup && verification.cleanup.completed ? 'yes' : 'no'}`
  ];

  if (verification.failedPhase) lines.push(`  Failed phase: ${escapeControlCharacters(verification.failedPhase)}`);
  if (verification.timedOut) lines.push('  Timed out: yes');
  if (verification.outputTruncated) lines.push('  Output truncated: yes');

  for (const [label, value] of [['stdout', verification.stdout], ['stderr', verification.stderr]]) {
    if (!value) continue;
    lines.push(`  ${label}:`);
    for (const line of boundedOutputLines(value)) {
      lines.push(`    ${line}`);
    }
  }

  return lines;
}

/**
 * Render a report for a terminal. Color is opt-in through the terminal's TTY
 * state and is always disabled for NO_COLOR, non-TTY output, or color:false.
 *
 * @param {unknown} report
 * @param {{ color?: boolean, isTTY?: boolean }} [options]
 * @returns {string}
 */
function renderText(report, options = {}) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const enabled = colorEnabled(options);
  const findings = findingsFor(safeReport);
  const counts = reportCounts(safeReport, findings);
  const status = escapeControlCharacters(reportStatus(safeReport));
  const lines = [
    paint('CloneProof — repository setup verification', ANSI.bold, enabled),
    `Target: ${escapeControlCharacters(targetName(safeReport))}`,
    `Status: ${status}`,
    '',
    'Counts:',
    `  Total: ${escapeControlCharacters(counts.total)}`,
    `  Passed: ${escapeControlCharacters(counts.passed)}`,
    `  Failed: ${escapeControlCharacters(counts.failed)}`,
    `  Warnings: ${escapeControlCharacters(counts.warnings)}`,
    `  Skipped: ${escapeControlCharacters(counts.skipped)}`,
    '',
    'Findings:'
  ];

  if (findings.length === 0) {
    lines.push('  (none)');
  } else {
    findings.forEach((finding, index) => {
      if (index > 0) {
        lines.push('');
      }
      lines.push(...renderFinding(finding, enabled));
    });
  }

  lines.push(...verificationLines(safeReport));

  return `${lines.join('\n')}\n`;
}

/**
 * Map report outcome to the process exit convention used by CloneProof.
 * Unknown outcomes intentionally fail closed with the incomplete/blocked code.
 *
 * @param {unknown} report
 * @returns {number}
 */
function exitCodeForReport(report) {
  const status = normalizeStatus(reportStatus(report));

  switch (status) {
    case 'passed':
    case 'passed_with_warnings':
      return 0;
    case 'failed':
      return 1;
    case 'blocked':
    case 'incomplete':
    default:
      return 2;
  }
}

module.exports = {
  renderJson,
  renderText,
  exitCodeForReport
};
