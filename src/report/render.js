'use strict';

const {
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  CHECK_GROUP_LABELS,
  NOT_CHECKED,
  NOT_CHECKED_LABELS
} = require('./coverage');

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

function reportCoverage(report) {
  const coverage = report && report.coverage && typeof report.coverage === 'object'
    ? report.coverage
    : {};
  return {
    checked: Array.isArray(coverage.checked) ? coverage.checked : [],
    notChecked: Array.isArray(coverage.notChecked) ? coverage.notChecked : [...NOT_CHECKED]
  };
}

function coverageLabel(id, labels) {
  return labels[id] || id;
}

function verificationHasNoTests(report) {
  if (!report || !report.verification || typeof report.verification !== 'object') return false;
  return report.verification.noTestsRan === true
    || findingsFor(report).some((finding) => finding && finding.code === 'VERIFY_NO_TESTS_RAN');
}

function successExplanation(report, checkedCount, findingCount) {
  const status = normalizeStatus(reportStatus(report));
  if (report && report.mode === 'check' && status === 'passed') {
    return `No known setup problems were found across ${checkedCount} check groups (${findingCount} findings). This is not a guarantee that a fresh clone works; see Not checked.`;
  }
  if (
    report
    && report.mode === 'verify'
    && report.verification
    && typeof report.verification === 'object'
    && normalizeStatus(report.verification.outcome) === 'passed'
    && !verificationHasNoTests(report)
  ) {
    return 'npm ci and npm test succeeded inside the controlled container.';
  }
  return null;
}

function textCoverageLines(report) {
  const coverage = reportCoverage(report);
  const lines = ['What was checked:'];
  if (coverage.checked.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const id of coverage.checked) {
      lines.push(`  - ${escapeControlCharacters(coverageLabel(id, CHECK_GROUP_LABELS))} (${escapeControlCharacters(id)})`);
    }
  }

  lines.push('', 'Not checked:');
  if (coverage.notChecked.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const id of coverage.notChecked) {
      lines.push(`  - ${escapeControlCharacters(coverageLabel(id, NOT_CHECKED_LABELS))} (${escapeControlCharacters(id)})`);
    }
  }
  return lines;
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

function targetCommit(report) {
  if (!report || typeof report !== 'object') return '';
  const target = report.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return '';
  const commit = target.commit;
  return typeof commit === 'string' && /^[0-9a-f]{40}$/i.test(commit)
    ? commit.slice(0, 12)
    : '';
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

const MAX_FINDING_EVIDENCE_ITEMS = 10;

function boundedEvidenceItems(finding) {
  const evidence = evidenceItems(finding);
  return {
    visible: evidence.slice(0, MAX_FINDING_EVIDENCE_ITEMS),
    remaining: Math.max(0, evidence.length - MAX_FINDING_EVIDENCE_ITEMS)
  };
}

function evidenceOverflowText(remaining) {
  return `… and ${remaining} more (see --format json)`;
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

  const boundedEvidence = boundedEvidenceItems(finding);
  const evidence = boundedEvidence.visible
    .map(evidenceText)
    .filter((item) => item.length > 0);
  if (evidence.length > 0) {
    lines.push('  Evidence:');
    for (const item of evidence) {
      lines.push(`    - ${item}`);
    }
    if (boundedEvidence.remaining > 0) {
      lines.push(`    - ${evidenceOverflowText(boundedEvidence.remaining)}`);
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
  const omittedLineCount = Math.max(0, rawLines.length - MAX_VERIFICATION_OUTPUT_LINES);
  const selected = rawLines.slice(-MAX_VERIFICATION_OUTPUT_LINES).map(escapeControlCharacters);
  let output = selected.join('\n');
  const indicators = [];
  if (omittedLineCount > 0) indicators.push(`... ${omittedLineCount} earlier lines omitted`);
  if (output.length > MAX_VERIFICATION_OUTPUT_CHARS) {
    indicators.push('... shortened to the last 4,000 characters');
    output = output.slice(-MAX_VERIFICATION_OUTPUT_CHARS);
  }
  return [...indicators, ...(output ? output.split('\n') : [])];
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

  if (verification.noTestsRan) lines.push('  Tests detected: no');
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
  const commit = targetCommit(safeReport);
  const coverage = reportCoverage(safeReport);
  const explanation = successExplanation(safeReport, coverage.checked.length, counts.total);
  const lines = [
    paint('CloneProof — repository setup verification', ANSI.bold, enabled),
    `Target: ${escapeControlCharacters(targetName(safeReport))}`,
    ...(commit ? [`Commit: ${escapeControlCharacters(commit)}`] : []),
    `Status: ${status}`,
    ...(explanation ? [escapeControlCharacters(explanation)] : []),
    '',
    ...textCoverageLines(safeReport),
    '',
    'Findings:',
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

const HTML_ESCAPE_CHARACTERS = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

const HTML_STYLES = `
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  background: #f7f8fa;
  color: #17202a;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1rem 4rem; }
main { max-width: 72rem; margin: 0 auto; }
h1, h2, h3, h4 { line-height: 1.2; }
h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 2.6rem); }
h2 { margin-top: 0; }
h3 { margin: 0.75rem 0 0.5rem; }
h4 { margin: 1rem 0 0.35rem; }
section, article { margin-top: 1.5rem; }
.panel, .finding { background: #fff; border: 1px solid #d8dee8; border-radius: 0.75rem; padding: 1.25rem; box-shadow: 0 0.15rem 0.5rem rgba(23, 32, 42, 0.06); }
.report-header { margin-bottom: 1.5rem; }
.report-subtitle { color: #536273; margin: 0.5rem 0 0; }
.metadata, .counts, .verification-details { display: grid; grid-template-columns: minmax(8rem, 13rem) 1fr; gap: 0.5rem 1rem; margin: 0; }
.metadata dt, .counts dt, .verification-details dt { font-weight: 700; }
.metadata dd, .counts dd, .verification-details dd { margin: 0; overflow-wrap: anywhere; }
.status { border-radius: 999px; display: inline-block; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; padding: 0.18rem 0.55rem; text-transform: uppercase; }
.status-passed { background: #d8f3df; color: #14532d; }
.status-failed { background: #fee2e2; color: #991b1b; }
.status-warning, .status-blocked, .status-incomplete { background: #fef3c7; color: #854d0e; }
.status-skipped, .status-unknown { background: #e5e7eb; color: #374151; }
.finding-meta { align-items: center; display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0; }
.finding-message { margin-bottom: 0; }
.report-explanation { margin: 0.5rem 0 0; }
.coverage-columns { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
.coverage-list { margin: 0.5rem 0 0; padding-left: 1.4rem; }
.coverage-list li { margin: 0.35rem 0; overflow-wrap: anywhere; }
.evidence { margin: 0.75rem 0 0; padding-left: 1.4rem; }
.evidence li { margin: 0.4rem 0; overflow-wrap: anywhere; }
.evidence-location { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.evidence-detail { overflow-wrap: anywhere; }
.recommendation { border-left: 0.25rem solid #64748b; margin-top: 1rem; padding-left: 0.85rem; }
.recommendation h4 { margin-top: 0; }
.muted { color: #536273; }
.verification-output { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); margin-top: 1.25rem; }
.verification-output h4 { margin-top: 0; }
pre { background: #111827; border-radius: 0.5rem; color: #f9fafb; margin: 0; max-height: 28rem; overflow: auto; padding: 0.9rem; white-space: pre-wrap; overflow-wrap: anywhere; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (prefers-color-scheme: dark) {
  :root { background: #111827; color: #e5e7eb; }
  .panel, .finding { background: #1f2937; border-color: #4b5563; }
  .report-subtitle, .muted { color: #cbd5e1; }
  .status-passed { background: #14532d; color: #dcfce7; }
  .status-failed { background: #7f1d1d; color: #fee2e2; }
  .status-warning, .status-blocked, .status-incomplete { background: #713f12; color: #fef3c7; }
  .status-skipped, .status-unknown { background: #374151; color: #e5e7eb; }
}
`;

function escapeHtml(value) {
  return textValue(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE_CHARACTERS[character]);
}

function htmlValue(value, fallback = '') {
  return escapeHtml(value === undefined || value === null ? fallback : value);
}

function htmlStatusClass(value) {
  const normalized = normalizeStatus(value);
  return Object.prototype.hasOwnProperty.call(STATUS_MARKERS, normalized) ? normalized : 'unknown';
}

function targetKind(report) {
  if (!report || typeof report !== 'object') {
    return 'unknown';
  }

  const target = report.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return textValue(target.kind, 'unknown') || 'unknown';
  }

  return 'unknown';
}

function htmlEvidenceItem(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return `<li>${htmlValue(item)}</li>`;
  }

  if (!item || typeof item !== 'object') {
    return '';
  }

  const path = item.path === undefined || item.path === null ? '' : textValue(item.path);
  const line = lineValue(item);
  const detail = item.detail === undefined || item.detail === null ? '' : textValue(item.detail);
  const location = path || line === undefined
    ? (path || (line === undefined ? '' : 'unknown path'))
    : 'unknown path';
  const locationWithLine = location && line !== undefined
    ? `${location}:${line}`
    : location;
  const parts = [];

  if (locationWithLine) {
    parts.push(`<code class="evidence-location">${escapeHtml(locationWithLine)}</code>`);
  }
  if (detail) {
    parts.push(`<span class="evidence-detail">${escapeHtml(detail)}</span>`);
  }

  return `<li>${parts.length > 0 ? parts.join(' <span aria-hidden="true">—</span> ') : '<span class="muted">(no detail recorded)</span>'}</li>`;
}

function htmlCoverage(report) {
  const coverage = reportCoverage(report);
  const checkedItems = coverage.checked.map((id) => (
    `<li>${htmlValue(coverageLabel(id, CHECK_GROUP_LABELS))} <code>${htmlValue(id)}</code></li>`
  ));
  const notCheckedItems = coverage.notChecked.map((id) => (
    `<li>${htmlValue(coverageLabel(id, NOT_CHECKED_LABELS))} <code>${htmlValue(id)}</code></li>`
  ));

  return [
    '<section class="panel" aria-labelledby="coverage-heading">',
    '  <h2 id="coverage-heading">Report coverage</h2>',
    '  <div class="coverage-columns">',
    '    <section aria-labelledby="checked-heading">',
    '      <h3 id="checked-heading">What was checked</h3>',
    checkedItems.length > 0
      ? `      <ul class="coverage-list">${checkedItems.join('')}</ul>`
      : '      <p class="muted">(none recorded)</p>',
    '    </section>',
    '    <section aria-labelledby="not-checked-heading">',
    '      <h3 id="not-checked-heading">Not checked</h3>',
    notCheckedItems.length > 0
      ? `      <ul class="coverage-list">${notCheckedItems.join('')}</ul>`
      : '      <p class="muted">(none recorded)</p>',
    '    </section>',
    '  </div>',
    '</section>'
  ].join('\n');
}

function htmlFinding(finding, index) {
  const status = normalizeStatus(statusValueForFinding(finding));
  const statusClass = htmlStatusClass(status);
  const code = findingText(finding, 'code', 'UNKNOWN');
  const title = findingText(finding, 'title', 'Untitled finding');
  const message = findingText(finding, 'message', 'No message provided');
  const recommendation = findingText(finding, 'recommendation', 'No recommendation provided');
  const boundedEvidence = boundedEvidenceItems(finding);
  const evidence = boundedEvidence.visible.map(htmlEvidenceItem).filter(Boolean);
  if (boundedEvidence.remaining > 0) {
    evidence.push(`<li>${htmlValue(evidenceOverflowText(boundedEvidence.remaining))}</li>`);
  }
  const titleId = `finding-${index}-title`;

  return [
    `<article class="finding finding-${statusClass}" aria-labelledby="${titleId}">`,
    '  <header>',
    `    <p class="finding-meta"><span class="status status-${statusClass}">${htmlValue(status)}</span> <code>${htmlValue(code)}</code></p>`,
    `    <h3 id="${titleId}">${htmlValue(title)}</h3>`,
    '  </header>',
    `  <p class="finding-message"><strong>Message:</strong> ${htmlValue(message)}</p>`,
    '  <section aria-labelledby="evidence-heading-' + index + '">',
    `    <h4 id="evidence-heading-${index}">Evidence</h4>`,
    evidence.length > 0
      ? `    <ul class="evidence">${evidence.join('')}</ul>`
      : '    <p class="muted">No evidence recorded.</p>',
    '  </section>',
    '  <section class="recommendation" aria-labelledby="recommendation-heading-' + index + '">',
    `    <h4 id="recommendation-heading-${index}">Recommendation</h4>`,
    `    <p>${htmlValue(recommendation)}</p>`,
    '  </section>',
    '</article>'
  ].join('\n');
}

function htmlOutput(value, emptyLabel) {
  const lines = value ? boundedOutputLines(value) : [];
  return lines.length > 0 ? escapeHtml(lines.join('\n')) : `<span class="muted">${emptyLabel}</span>`;
}

function htmlVerification(report) {
  if (!report || !report.verification || typeof report.verification !== 'object' || Array.isArray(report.verification)) {
    return '';
  }

  const verification = report.verification;
  const outcome = verification.outcome || 'unknown';
  const outcomeClass = htmlStatusClass(outcome);
  const networkMode = verification.networkMode || 'unknown';
  const networkConsent = verification.networkConsent ? 'explicitly allowed' : 'disabled by default';
  const exitCode = verification.exitCode === null || verification.exitCode === undefined
    ? 'n/a'
    : verification.exitCode;
  const cleanup = verification.cleanup && typeof verification.cleanup === 'object' && !Array.isArray(verification.cleanup)
    ? verification.cleanup
    : {};
  const optionalRows = [];

  if (verification.image) {
    optionalRows.push(`<dt>Image</dt><dd><code>${htmlValue(verification.image)}</code></dd>`);
  }
  if (verification.failedPhase) {
    optionalRows.push(`<dt>Failed phase</dt><dd>${htmlValue(verification.failedPhase)}</dd>`);
  }
  if (verification.timedOut) {
    optionalRows.push('<dt>Timed out</dt><dd>yes</dd>');
  }
  if (verification.outputTruncated) {
    optionalRows.push('<dt>Output truncated</dt><dd>yes</dd>');
  }
  if (verification.noTestsRan) {
    optionalRows.push('<dt>Tests detected</dt><dd>no</dd>');
  }

  return [
    '<section class="panel" aria-labelledby="verification-heading">',
    '  <h2 id="verification-heading">Docker verification</h2>',
    '  <dl class="verification-details">',
    `    <dt>Outcome</dt><dd><span class="status status-${outcomeClass}">${htmlValue(outcome)}</span></dd>`,
    `    <dt>Network</dt><dd><code>${htmlValue(networkMode)}</code> <span class="muted">(${networkConsent})</span></dd>`,
    `    <dt>Exit code</dt><dd><code>${htmlValue(exitCode)}</code></dd>`,
    `    <dt>Cleanup complete</dt><dd>${cleanup.completed ? 'yes' : 'no'}</dd>`,
    ...optionalRows.map((row) => `    ${row}`),
    '  </dl>',
    '  <div class="verification-output" aria-labelledby="verification-output-heading">',
    '    <h3 id="verification-output-heading">Output</h3>',
    '    <section aria-labelledby="stdout-heading">',
    '      <h4 id="stdout-heading">stdout</h4>',
    `      <pre data-stream="stdout" aria-label="Verification stdout"><code>${htmlOutput(verification.stdout, '(no stdout captured)')}</code></pre>`,
    '    </section>',
    '    <section aria-labelledby="stderr-heading">',
    '      <h4 id="stderr-heading">stderr</h4>',
    `      <pre data-stream="stderr" aria-label="Verification stderr"><code>${htmlOutput(verification.stderr, '(no stderr captured)')}</code></pre>`,
    '    </section>',
    '  </div>',
    '</section>'
  ].join('\n');
}

/**
 * Render schema-version-2 report fields as a self-contained accessible HTML document.
 * No report value is inserted into markup without HTML escaping, and verification
 * output uses the same line and character bounds as renderText.
 *
 * @param {unknown} report
 * @returns {string}
 */
function renderHtml(report) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const findings = findingsFor(safeReport);
  const counts = reportCounts(safeReport, findings);
  const status = reportStatus(safeReport);
  const statusClass = htmlStatusClass(status);
  const commit = targetCommit(safeReport);
  const coverage = reportCoverage(safeReport);
  const explanation = successExplanation(safeReport, coverage.checked.length, counts.total);
  const findingMarkup = findings.length > 0
    ? findings.map(htmlFinding).join('\n')
    : '<p class="muted">No findings recorded.</p>';

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>CloneProof report</title>',
    `  <style>${HTML_STYLES}</style>`,
    '</head>',
    '<body>',
    '  <main>',
    '    <header class="report-header">',
    '      <h1>CloneProof — repository setup verification</h1>',
    `      <p class="report-subtitle"><strong>Target:</strong> ${htmlValue(targetName(safeReport))} <span aria-hidden="true">·</span> ${htmlValue(targetKind(safeReport))}${commit ? ` <span aria-hidden="true">·</span> <strong>Commit:</strong> ${htmlValue(commit)}` : ''}</p>`,
    '    </header>',
    '    <section class="panel" aria-labelledby="summary-heading">',
    '      <h2 id="summary-heading">Summary</h2>',
    `      <p>Status: <span class="status status-${statusClass}">${htmlValue(status)}</span></p>`,
    ...(explanation ? [`      <p class="report-explanation">${htmlValue(explanation)}</p>`] : []),
    '      <h3 id="counts-heading">Findings</h3>',
    '      <dl class="counts" aria-labelledby="counts-heading">',
    `        <dt>Total</dt><dd>${htmlValue(counts.total)}</dd>`,
    `        <dt>Passed</dt><dd>${htmlValue(counts.passed)}</dd>`,
    `        <dt>Failed</dt><dd>${htmlValue(counts.failed)}</dd>`,
    `        <dt>Warnings</dt><dd>${htmlValue(counts.warnings)}</dd>`,
    `        <dt>Skipped</dt><dd>${htmlValue(counts.skipped)}</dd>`,
    '      </dl>',
    '    </section>',
    htmlCoverage(safeReport),
    '    <section aria-labelledby="findings-heading">',
    `      <h2 id="findings-heading">Findings <span class="muted">(${findings.length})</span></h2>`,
    findingMarkup,
    '    </section>',
    htmlVerification(safeReport),
    '  </main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
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
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  CHECK_GROUP_LABELS,
  NOT_CHECKED,
  NOT_CHECKED_LABELS,
  renderJson,
  renderText,
  renderHtml,
  exitCodeForReport
};
