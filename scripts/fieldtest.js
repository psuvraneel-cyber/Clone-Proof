'use strict';

// Repeatable public-repository field test (Run 5 and later).
//
//   node scripts/fieldtest.js sample  --seed N --count N --out FILE
//   node scripts/fieldtest.js run     --sample FILE --out FILE [--reports DIR]
//   node scripts/fieldtest.js summary --results FILE --judgments FILE [--sample FILE]
//
// `sample` draws repositories from GitHub search with a seeded PRNG and records
// facts and pre-registered expectations through the authenticated `gh` CLI. It
// never clones or runs repository code. `run` invokes `cloneproof check` on each
// sampled URL. `summary` combines results with per-finding judgments and prints
// Markdown tables with Wilson 95% intervals.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

const FRAME = {
  languages: ['JavaScript', 'TypeScript'],
  createdFrom: '2014-01-01',
  createdTo: '2025-10-29',
  pushedSince: '2025-10-30',
  minStars: 10
};
const LOCKFILES = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun'
};
const BLOCKING_STATUS = 'failed';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--')) throw new Error(`Unexpected argument ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  return options;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ghApi(args) {
  const result = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const error = new Error((result.stderr || '').trim() || `gh api ${args.join(' ')} failed`);
    error.notFound = /HTTP 404/.test(result.stderr || '');
    throw error;
  }
  return JSON.parse(result.stdout);
}

function dayFromOffset(offset) {
  const start = Date.parse(`${FRAME.createdFrom}T00:00:00Z`);
  return new Date(start + offset * 86400000).toISOString().slice(0, 10);
}

function frameDays() {
  return Math.round((Date.parse(`${FRAME.createdTo}T00:00:00Z`) - Date.parse(`${FRAME.createdFrom}T00:00:00Z`)) / 86400000) + 1;
}

function searchQuery(language, day) {
  return `language:${language} created:${day} stars:>=${FRAME.minStars} pushed:>=${FRAME.pushedSince} fork:false archived:false is:public`;
}

function decodeContent(entry) {
  return Buffer.from(entry.content || '', 'base64').toString('utf8');
}

// Mirrors the scanner: only a JSON object is a usable package manifest.
function parseManifest(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function testScriptKind(script) {
  if (typeof script !== 'string' || !script.trim()) return 'missing';
  if (/no test specified/i.test(script)) return 'placeholder';
  return 'present';
}

function managerName(packageManager) {
  if (typeof packageManager !== 'string') return null;
  const match = /^(npm|yarn|pnpm|bun)@/.exec(packageManager.trim());
  return match ? match[1] : 'other';
}

// Pre-registered expectation rules; see docs/FIELD_TEST.md, Run 5.
function expectedFindings(facts) {
  if (facts.packageJsonValid === false) return ['PACKAGE_JSON_INVALID'];
  const expected = [];
  if (facts.testScript === 'missing') expected.push(facts.workspaces ? 'MONOREPO_ROOT_TEST_SCRIPT_MISSING' : 'TEST_SCRIPT_MISSING');
  if (facts.testScript === 'placeholder') expected.push('TEST_SCRIPT_PLACEHOLDER');
  const lockManagers = [...new Set(facts.lockfiles.map((name) => LOCKFILES[name]))];
  if (lockManagers.length === 0) expected.push('LOCKFILE_MISSING');
  const declared = managerName(facts.packageManager);
  if (declared && declared !== 'other' && lockManagers.length === 1 && lockManagers[0] !== declared) {
    expected.push('PACKAGE_MANAGER_LOCKFILE_MISMATCH');
  }
  return expected.sort();
}

function collectFacts(repository) {
  const [owner, name] = repository.full_name.split('/');
  const listing = ghApi([`repos/${owner}/${name}/contents/`]);
  const files = new Set(listing.filter((entry) => entry.type === 'file').map((entry) => entry.name));
  if (!files.has('package.json')) return { rejected: 'no-root-package-json' };
  const packageEntry = ghApi([`repos/${owner}/${name}/contents/package.json`]);
  const packageData = parseManifest(decodeContent(packageEntry));
  const scripts = packageData && packageData.scripts && typeof packageData.scripts === 'object' ? packageData.scripts : {};
  const head = ghApi([`repos/${owner}/${name}/commits/${encodeURIComponent(repository.default_branch)}`]);
  const facts = {
    repository: repository.full_name,
    url: `https://github.com/${repository.full_name}`,
    language: repository.language,
    stars: repository.stargazers_count,
    createdAt: repository.created_at.slice(0, 10),
    pushedAt: repository.pushed_at.slice(0, 10),
    sizeKb: repository.size,
    defaultBranch: repository.default_branch,
    headCommit: head.sha,
    packageJsonValid: packageData !== null,
    private: Boolean(packageData && packageData.private),
    workspaces: Boolean(packageData && packageData.workspaces) || files.has('pnpm-workspace.yaml'),
    testScript: testScriptKind(scripts.test),
    packageManager: packageData && typeof packageData.packageManager === 'string' ? packageData.packageManager : null,
    lockfiles: Object.keys(LOCKFILES).filter((file) => files.has(file)),
    nvmrc: files.has('.nvmrc'),
    readme: [...files].some((file) => /^readme(\.|$)/i.test(file))
  };
  facts.expected = expectedFindings(facts);
  return { facts };
}

async function sample(options) {
  const seed = Number(options.seed);
  const count = Number(options.count);
  const maxDraws = Number(options['max-draws'] || count * 5);
  if (!Number.isInteger(seed) || !Number.isInteger(count)) throw new Error('--seed and --count must be integers');
  const random = mulberry32(seed);
  const days = frameDays();
  const seen = new Set();
  const draws = [];
  const accepted = [];

  for (let draw = 1; accepted.length < count && draw <= maxDraws; draw += 1) {
    const language = FRAME.languages[Math.floor(random() * FRAME.languages.length)];
    const day = dayFromOffset(Math.floor(random() * days));
    const pick = random();
    const record = { draw, language, day };
    const firstPage = ghApi(['-X', 'GET', 'search/repositories', '-f', `q=${searchQuery(language, day)}`, '-f', 'per_page=100', '-f', 'page=1']);
    await sleep(2500);
    const available = Math.min(firstPage.total_count, 1000);
    record.totalCount = firstPage.total_count;
    if (available === 0) {
      draws.push({ ...record, outcome: 'empty' });
      continue;
    }
    const index = Math.floor(pick * available);
    let items = firstPage.items;
    if (index >= 100) {
      items = ghApi(['-X', 'GET', 'search/repositories', '-f', `q=${searchQuery(language, day)}`, '-f', 'per_page=100', '-f', `page=${Math.floor(index / 100) + 1}`]).items;
      await sleep(2500);
    }
    const repository = items[index % 100];
    if (!repository) {
      draws.push({ ...record, index, outcome: 'rejected', reason: 'search-page-short' });
      continue;
    }
    record.index = index;
    record.repository = repository.full_name;
    if (seen.has(repository.full_name)) {
      draws.push({ ...record, outcome: 'rejected', reason: 'duplicate' });
      continue;
    }
    seen.add(repository.full_name);
    let collected;
    try {
      collected = collectFacts(repository);
    } catch (error) {
      collected = { rejected: error.notFound ? 'contents-not-found' : 'api-error' };
    }
    if (collected.rejected) {
      draws.push({ ...record, outcome: 'rejected', reason: collected.rejected });
      continue;
    }
    draws.push({ ...record, outcome: 'accepted' });
    accepted.push(collected.facts);
    process.stderr.write(`[${accepted.length}/${count}] ${repository.full_name}\n`);
  }

  const output = { seed, count, frame: FRAME, queryTemplate: searchQuery('<language>', '<day>'), draws, sample: accepted };
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Accepted ${accepted.length} of ${draws.length} draws.\n`);
}

function run(options) {
  const input = JSON.parse(fs.readFileSync(options.sample, 'utf8'));
  const reportsDir = path.resolve(options.reports || path.join(root, 'reports', 'field', 'run5'));
  fs.mkdirSync(reportsDir, { recursive: true });
  const results = [];
  for (const facts of input.sample) {
    const reportPath = path.join(reportsDir, `${facts.repository.replace('/', '__')}.json`);
    fs.rmSync(reportPath, { force: true });
    const started = process.hrtime.bigint();
    const child = spawnSync(process.execPath, [path.join(root, 'src', 'cli.js'), 'check', facts.url, '--format', 'json', '--output', reportPath], {
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024
    });
    const durationMs = Number((process.hrtime.bigint() - started) / 1000000n);
    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch {
      report = null;
    }
    results.push({
      repository: facts.repository,
      exitCode: child.status,
      durationMs,
      status: report ? report.status : null,
      commit: report && report.target ? report.target.commit || null : null,
      preflightReason: report && report.target ? report.target.preflightReason || null : null,
      expected: facts.expected,
      findings: report
        ? report.findings.filter((finding) => finding.status === 'failed' || finding.status === 'warning')
          .map((finding) => ({ code: finding.code, status: finding.status, message: finding.message, evidence: (finding.evidence || []).slice(0, 10) }))
        : []
    });
    process.stderr.write(`${facts.repository}: ${report ? report.status : 'no report'} (exit ${child.status}, ${durationMs} ms)\n`);
  }
  fs.writeFileSync(options.out, `${JSON.stringify({ results }, null, 2)}\n`);
}

function wilson(successes, total) {
  if (total === 0) return null;
  const z = 1.959964;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

// Findings are clustered within repositories, the sampled units, so the
// finding-level interval resamples repositories (seeded percentile bootstrap).
function clusterBootstrap(clusters, { iterations = 10000, seed = 20261030 } = {}) {
  const groups = clusters.filter((cluster) => cluster.total > 0);
  if (groups.length === 0) return null;
  const random = mulberry32(seed);
  const ratios = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let successes = 0;
    let total = 0;
    for (let draw = 0; draw < groups.length; draw += 1) {
      const group = groups[Math.floor(random() * groups.length)];
      successes += group.successes;
      total += group.total;
    }
    ratios.push(successes / total);
  }
  ratios.sort((left, right) => left - right);
  return [ratios[Math.floor(0.025 * iterations)], ratios[Math.ceil(0.975 * iterations) - 1]];
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function rate(successes, total, interval, label) {
  if (total === 0) return 'n/a (0 findings)';
  const [low, high] = interval;
  return `${successes} / ${total} = **${percent(successes / total)}** (95% ${label} ${percent(low)}–${percent(high)})`;
}

function findingRate(subset, predicate) {
  const byRepository = new Map();
  for (const row of subset) {
    const cluster = byRepository.get(row.repository) || { successes: 0, total: 0 };
    cluster.total += 1;
    if (predicate(row)) cluster.successes += 1;
    byRepository.set(row.repository, cluster);
  }
  const successes = subset.filter(predicate).length;
  const clusters = [...byRepository.values()];
  // With one finding per repository the findings are independent units and
  // Wilson applies; a percentile bootstrap would collapse to zero width at 0% or 100%.
  if (clusters.every((cluster) => cluster.total === 1)) {
    return rate(successes, subset.length, wilson(successes, subset.length), 'Wilson CI');
  }
  return rate(successes, subset.length, clusterBootstrap(clusters), 'cluster-bootstrap CI');
}

function summary(options) {
  const { results } = JSON.parse(fs.readFileSync(options.results, 'utf8'));
  const { judgments } = JSON.parse(fs.readFileSync(options.judgments, 'utf8'));
  const key = (repository, code) => `${repository} ${code}`;
  const byKey = new Map(judgments.map((entry) => [key(entry.repository, entry.code), entry]));
  const rows = [];
  for (const result of results) {
    for (const finding of result.findings) {
      const judgment = byKey.get(key(result.repository, finding.code));
      if (!judgment) throw new Error(`No judgment for ${result.repository} ${finding.code}`);
      rows.push({ ...finding, repository: result.repository, judgment: judgment.judgment, reason: judgment.reason });
    }
  }
  const lines = [];
  for (const status of [BLOCKING_STATUS, 'warning']) {
    const subset = rows.filter((row) => row.status === status);
    const real = subset.filter((row) => row.judgment === 'real').length;
    const correct = subset.filter((row) => row.judgment !== 'false').length;
    lines.push(`| ${status === BLOCKING_STATUS ? 'Blocking (failed)' : 'Warning'} | ${subset.length} | ${real} | ${correct - real} | ${subset.length - correct} | ${findingRate(subset, (row) => row.judgment === 'real')} | ${findingRate(subset, (row) => row.judgment !== 'false')} |`);
  }
  const exitOne = results.filter((result) => result.exitCode === 1);
  const justified = exitOne.filter((result) => rows.some((row) => row.repository === result.repository && row.status === BLOCKING_STATUS && row.judgment === 'real'));
  const languageLines = [];
  if (options.sample) {
    const languages = new Map(JSON.parse(fs.readFileSync(options.sample, 'utf8')).sample.map((facts) => [facts.repository, facts.language]));
    for (const language of [...new Set(languages.values())].sort()) {
      const repositories = results.filter((result) => languages.get(result.repository) === language).length;
      const cells = [BLOCKING_STATUS, 'warning'].map((status) => {
        const subset = rows.filter((row) => row.status === status && languages.get(row.repository) === language);
        return `${subset.filter((row) => row.judgment === 'real').length} / ${subset.length}`;
      });
      languageLines.push(`| ${language} | ${repositories} | ${cells.join(' | ')} |`);
    }
  }
  const codes = [...new Set(rows.map((row) => `${row.status} ${row.code}`))].sort();
  const perCode = codes.map((entry) => {
    const [status, code] = entry.split(' ');
    const subset = rows.filter((row) => row.status === status && row.code === code);
    const count = (judgment) => subset.filter((row) => row.judgment === judgment).length;
    return `| \`${code}\` | ${status} | ${subset.length} | ${count('real')} | ${count('policy')} | ${count('false')} |`;
  });
  process.stdout.write([
    '| Findings | Total | Real | Policy | False | Precision (real) | Correctness (real + policy) |',
    '|---|---:|---:|---:|---:|---|---|',
    ...lines,
    '',
    `Repositories with exit 1: ${exitOne.length} of ${results.length}; justified by at least one real blocking finding: ${rate(justified.length, exitOne.length, wilson(justified.length, exitOne.length) || [0, 0], 'Wilson CI')}.`,
    '',
    ...(languageLines.length ? [
      '| Language | Repositories | Real / blocking | Real / warnings |',
      '|---|---:|---:|---:|',
      ...languageLines,
      ''
    ] : []),
    '| Code | Status | Total | Real | Policy | False |',
    '|---|---|---:|---:|---:|---:|',
    ...perCode,
    ''
  ].join('\n'));
}

const handlers = { sample, run, summary };

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  if (!handlers[command]) {
    process.stderr.write('Usage: node scripts/fieldtest.js sample|run|summary [options]\n');
    process.exit(2);
  }
  Promise.resolve(handlers[command](parseArgs(rest))).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { clusterBootstrap, expectedFindings, mulberry32, parseManifest, testScriptKind, wilson };
