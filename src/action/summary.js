'use strict';

const fs = require('node:fs');
const { CHECK_GROUP_LABELS, NOT_CHECKED_LABELS } = require('../report/coverage');
const { extractFindingLocation } = require('./annotations');

const MAX_SUMMARY_BYTES = 512 * 1024; // 524,288 bytes

const STATUS_DISPLAY_LABELS = Object.freeze({
  passed: 'PASSED',
  passed_with_warnings: 'PASSED WITH WARNINGS',
  failed: 'FAILED',
  blocked: 'BLOCKED',
  incomplete: 'INCOMPLETE'
});

const FINDING_STATUS_BADGES = Object.freeze({
  failed: '❌ Failed',
  warning: '⚠️ Warning',
  skipped: 'ℹ️ Skipped'
});

/**
 * Escapes Markdown and HTML metacharacters in untrusted text so it cannot
 * alter Markdown structure, inject headings, links, tables, or scripts.
 */
function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/#/g, '\\#')
    .replace(/\|/g, '\\|');
}

/**
 * Escapes text intended for a Markdown table cell, stripping newlines
 * to prevent table-row breakage.
 */
function escapeTableCell(text) {
  if (text === null || text === undefined) return '';
  return escapeMarkdown(String(text).replace(/[\r\n]+/g, ' '));
}

/**
 * Escapes code-like text formatted inside inline backticks in a table cell.
 * Neutralizes backticks, HTML tags, and table delimiter pipes without
 * escaping standard identifier characters like underscores or dashes.
 */
function escapeInlineCode(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, "'")
    .replace(/\|/g, '\\|')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Enforces the maximum UTF-8 byte limit on the summary string.
 * Truncates cleanly before multibyte Unicode boundaries, breaks at
 * the nearest newline, and appends a visible truncation notice.
 */
function enforceSummaryByteLimit(markdown, maxBytes = MAX_SUMMARY_BYTES) {
  const currentBytes = Buffer.byteLength(markdown, 'utf8');
  if (currentBytes <= maxBytes) return markdown;

  const notice = '\n\n---\n\n**Note:** Job summary truncated to stay within GitHub Actions size limits (512 KiB). All findings are preserved in the JSON report.\n';
  const noticeBytes = Buffer.byteLength(notice, 'utf8');
  const targetBytes = maxBytes - noticeBytes;

  if (targetBytes <= 0) return notice;

  const buf = Buffer.from(markdown, 'utf8');
  let cutIndex = targetBytes;

  // Walk backward if cutIndex points to a UTF-8 continuation byte (10xxxxxx)
  while (cutIndex > 0 && (buf[cutIndex] & 0xC0) === 0x80) {
    cutIndex -= 1;
  }

  // If buf[cutIndex] is the leading byte of a multibyte sequence that would overflow, step back
  if (cutIndex > 0) {
    const leadByte = buf[cutIndex];
    let seqLen = 1;
    if ((leadByte & 0xE0) === 0xC0) seqLen = 2;
    else if ((leadByte & 0xF0) === 0xE0) seqLen = 3;
    else if ((leadByte & 0xF8) === 0xF0) seqLen = 4;

    if (cutIndex + seqLen > targetBytes) {
      // Incomplete multibyte sequence at target limit; cut before leadByte
    } else {
      cutIndex += seqLen;
    }
  }

  const slicedString = buf.subarray(0, cutIndex).toString('utf8');
  const lastNewline = slicedString.lastIndexOf('\n');
  const cleanString = lastNewline > targetBytes / 2 ? slicedString.slice(0, lastNewline) : slicedString;

  return cleanString + notice;
}

/**
 * Renders a validated CloneProof report into GitHub-flavoured Markdown.
 */
function renderJobSummary(report, options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const targetRoot = options.targetRoot || workspaceRoot;
  const reportPath = options.reportPath || '';
  const omittedAnnotationCount = options.omittedAnnotationCount || 0;

  const lines = [];

  // A. Header
  const rawStatus = report && typeof report.status === 'string' ? report.status : 'unknown';
  const displayStatus = STATUS_DISPLAY_LABELS[rawStatus] || escapeMarkdown(rawStatus.toUpperCase());
  lines.push('# CloneProof Repository Check\n');
  lines.push(`**Result:** ${displayStatus}\n`);

  // B. Summary Metrics
  if (report && report.summary && typeof report.summary === 'object') {
    lines.push('## Summary\n');
    lines.push('| Metric | Count |');
    lines.push('|---|---|');
    lines.push(`| Total checks | ${Number(report.summary.total) || 0} |`);
    lines.push(`| Passed | ${Number(report.summary.passed) || 0} |`);
    lines.push(`| Failed | ${Number(report.summary.failed) || 0} |`);
    lines.push(`| Warnings | ${Number(report.summary.warnings) || 0} |`);
    lines.push(`| Skipped | ${Number(report.summary.skipped) || 0} |\n`);
  }

  // C. Findings
  lines.push('## Findings\n');
  const nonPassedFindings = Array.isArray(report && report.findings)
    ? report.findings.filter((f) => f && f.status !== 'passed')
    : [];

  if (nonPassedFindings.length === 0) {
    lines.push('No issues or warnings detected.\n');
  } else {
    lines.push('| Status | Code | Message | Location | Recommendation |');
    lines.push('|---|---|---|---|---|');

    for (const finding of nonPassedFindings) {
      const badge = FINDING_STATUS_BADGES[finding.status] || escapeTableCell(finding.status || 'unknown');
      const code = escapeInlineCode(finding.code || 'UNKNOWN');
      const message = escapeTableCell(finding.message || finding.title || '—');

      const loc = extractFindingLocation(finding, workspaceRoot, targetRoot);
      let locationStr = '—';
      if (loc && loc.file) {
        const file = escapeInlineCode(loc.file);
        locationStr = loc.line ? `\`${file}:${loc.line}\`` : `\`${file}\``;
      }

      const rec = typeof finding.recommendation === 'string' && finding.recommendation.trim() !== ''
        ? escapeTableCell(finding.recommendation.trim())
        : '—';

      lines.push(`| ${badge} | \`${code}\` | ${message} | ${locationStr} | ${rec} |`);
    }
    lines.push('');
  }

  // D. Coverage and Verification Scope
  if (report && report.coverage && typeof report.coverage === 'object') {
    lines.push('## Coverage & Verification Scope\n');

    if (Array.isArray(report.coverage.checked) && report.coverage.checked.length > 0) {
      lines.push('### Checks performed\n');
      for (const id of report.coverage.checked) {
        const label = CHECK_GROUP_LABELS[id] || id;
        lines.push(`- ${escapeMarkdown(label)}`);
      }
      lines.push('');
    }

    if (Array.isArray(report.coverage.notChecked) && report.coverage.notChecked.length > 0) {
      lines.push('### Scopes not checked\n');
      for (const id of report.coverage.notChecked) {
        const label = NOT_CHECKED_LABELS[id] || id;
        lines.push(`- ${escapeMarkdown(label)}`);
      }
      lines.push('');
    }
  }

  // E. Annotation Truncation
  if (omittedAnnotationCount > 0) {
    lines.push('## Annotations\n');
    lines.push(`**Annotation limit reached:** ${omittedAnnotationCount} additional findings were not emitted as workflow annotations. All findings remain available in the CloneProof JSON report.\n`);
  }

  // F. Report Location
  if (reportPath) {
    lines.push('## Report Location\n');
    lines.push(`Report saved to: \`${escapeMarkdown(reportPath)}\`\n`);
    lines.push('*(Note: this is a local path on the runner host; files stored under runner temporary directories are not automatically uploaded as GitHub workflow artifacts.)*\n');
  }

  const rawMarkdown = lines.join('\n');
  return enforceSummaryByteLimit(rawMarkdown);
}

/**
 * Appends the generated Markdown summary to GITHUB_STEP_SUMMARY.
 * Fails safely and gracefully if the environment variable is not set
 * or if filesystem write operations encounter errors.
 */
function writeJobSummary(summaryMarkdown, summaryFilePath = process.env.GITHUB_STEP_SUMMARY, stderr = process.stderr) {
  if (!summaryFilePath || typeof summaryFilePath !== 'string' || summaryFilePath.trim() === '') {
    return { written: false, skipped: true };
  }

  try {
    fs.appendFileSync(summaryFilePath, summaryMarkdown, 'utf8');
    return { written: true, skipped: false };
  } catch (error) {
    if (stderr && typeof stderr.write === 'function') {
      stderr.write(`CloneProof Action: failed to write job summary: ${error.message}\n`);
    }
    return { written: false, skipped: false, error };
  }
}

module.exports = {
  FINDING_STATUS_BADGES,
  MAX_SUMMARY_BYTES,
  STATUS_DISPLAY_LABELS,
  enforceSummaryByteLimit,
  escapeInlineCode,
  escapeMarkdown,
  escapeTableCell,
  renderJobSummary,
  writeJobSummary
};
