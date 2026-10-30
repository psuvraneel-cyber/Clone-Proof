'use strict';

// Generates the launch-post images (cover and charts) as standalone HTML in
// docs/blog/images/src/. Render them to PNG with a headless Chromium browser:
//   node scripts/blog-images.js
//   msedge --headless --screenshot=OUT.png --window-size=W,H --force-device-scale-factor=2 FILE.html
// Every number comes from the committed Run 6 files in docs/field-test/.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'blog', 'images', 'src');
const fieldTest = (name) => JSON.parse(fs.readFileSync(path.join(root, 'docs', 'field-test', name), 'utf8'));

// Reference palette (dataviz skill): categorical slots 1, 3, 2, validated
// all-pairs on the light surface; aqua is below 3:1, so every segment is labeled.
const COLORS = { real: '#2a78d6', policy: '#1baf7a', false: '#eb6834' };
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const GRID = '#e4e3df';

function tally(resultsFile, judgmentsFile) {
  const { results } = fieldTest(resultsFile);
  const judgments = new Map(fieldTest(judgmentsFile).judgments.map((entry) => [`${entry.repository} ${entry.code}`, entry.judgment]));
  const counts = { failed: { real: 0, policy: 0, false: 0 }, warning: { real: 0, policy: 0, false: 0 } };
  for (const result of results) {
    for (const finding of result.findings) {
      const judgment = judgments.get(`${result.repository} ${finding.code}`);
      if (!judgment) throw new Error(`No judgment for ${result.repository} ${finding.code}`);
      counts[finding.status][judgment] += 1;
    }
  }
  return { counts, failing: results.filter((result) => result.exitCode === 1).length };
}

function page(width, height, body, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:${SURFACE};color:${INK};font-family:"Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif}
${extraCss}</style></head><body>${body}</body></html>\n`;
}

function stackedBars({ title, subtitle, rows, width = 1000 }) {
  const left = 170;
  const right = 40;
  const barHeight = 34;
  const rowGap = 22;
  const groupGap = 52;
  const max = Math.max(...rows.flatMap((group) => group.bars.map((bar) => bar.real + bar.policy + bar.false)));
  const scale = (width - left - right) / max;
  let y = 176;
  let svg = '';
  for (const group of rows) {
    svg += `<text x="24" y="${y - 30}" font-size="15" font-weight="600" fill="${INK}">${group.label}</text>`;
    for (const bar of group.bars) {
      svg += `<text x="${left - 14}" y="${y + barHeight / 2 + 5}" font-size="14" fill="${INK_2}" text-anchor="end">${bar.label}</text>`;
      let x = left;
      for (const key of ['real', 'policy', 'false']) {
        const value = bar[key];
        if (!value) continue;
        const w = value * scale;
        svg += `<rect x="${x}" y="${y}" width="${Math.max(w - 2, 1)}" height="${barHeight}" rx="4" fill="${COLORS[key]}"/>`;
        // Too narrow for an inside label: put the number just above the segment.
        const label = w >= 30 ? `<text x="${x + w / 2 - 1}" y="${y + barHeight / 2 + 5}" font-size="14" font-weight="600" fill="#fff" text-anchor="middle">${value}</text>`
          : `<text x="${x + w / 2 - 1}" y="${y - 5}" font-size="13" font-weight="600" fill="${INK}" text-anchor="middle">${value}</text>`;
        svg += label;
        x += w;
      }
      y += barHeight + rowGap - 8;
    }
    y += groupGap;
  }
  const height = y + 10;
  const legend = ['real', 'policy', 'false'].map((key) => `<span class="key"><i style="background:${COLORS[key]}"></i>${{ real: 'Real', policy: 'Policy (true, but a deliberate choice)', false: 'False' }[key]}</span>`).join('');
  return {
    height,
    html: page(width, height, `<header><h1>${title}</h1><p>${subtitle}</p><div class="legend">${legend}</div></header>
<svg width="${width}" height="${height}" style="position:absolute;top:0;left:0">${svg}</svg>`,
    `header{position:absolute;top:22px;left:24px;right:24px}
h1{font-size:22px;font-weight:650;letter-spacing:-.01em}
p{font-size:14px;color:${INK_2};margin-top:4px}
.legend{display:flex;gap:18px;margin-top:10px;font-size:13px;color:${INK_2}}
.key{display:flex;align-items:center;gap:6px}.key i{width:12px;height:12px;border-radius:3px;display:inline-block}`)
  };
}

function simpleBars({ title, subtitle, bars, color, width = 1000, note }) {
  const left = 300;
  const right = 60;
  const barHeight = 30;
  const max = Math.max(...bars.map((bar) => bar.value));
  const scale = (width - left - right) / max;
  let y = 96;
  let svg = '';
  for (const bar of bars) {
    const w = bar.value * scale;
    svg += `<text x="${left - 14}" y="${y + barHeight / 2 + 5}" font-size="14" fill="${INK_2}" text-anchor="end">${bar.label}</text>`;
    svg += `<rect x="${left}" y="${y}" width="${Math.max(w, 2)}" height="${barHeight}" rx="4" fill="${bar.color || color}"/>`;
    svg += `<text x="${left + w + 8}" y="${y + barHeight / 2 + 5}" font-size="14" font-weight="600" fill="${INK}">${bar.value}</text>`;
    y += barHeight + 12;
  }
  const height = y + (note ? 40 : 14);
  return {
    height,
    html: page(width, height, `<header><h1>${title}</h1><p>${subtitle}</p></header>
<svg width="${width}" height="${height}" style="position:absolute;top:0;left:0">${svg}</svg>${note ? `<footer>${note}</footer>` : ''}`,
    `header{position:absolute;top:22px;left:24px;right:24px}
h1{font-size:22px;font-weight:650;letter-spacing:-.01em}
p{font-size:14px;color:${INK_2};margin-top:4px}
footer{position:absolute;bottom:14px;left:24px;font-size:12.5px;color:${INK_2}}`)
  };
}

function cover(before, after) {
  const width = 1000;
  const height = 420;
  return {
    height,
    html: page(width, height, `<div class="wrap">
<div class="eyebrow">CloneProof · field test of the top 100 npm repositories</div>
<h1>We fresh-cloned the top 100 npm packages.<br>The biggest problem was in our own tool.</h1>
<div class="stats">
  <div class="stat"><b>${before.counts.failed.false} → ${after.counts.failed.false}</b><span>false build failures</span></div>
  <div class="stat"><b>${before.failing} → ${after.failing}</b><span>repos failing CI, all real</span></div>
  <div class="stat"><b>${after.counts.warning.real + after.counts.warning.policy}/${after.counts.warning.real + after.counts.warning.policy + after.counts.warning.false}</b><span>warnings correct</span></div>
</div>
<div class="foot"><code>npx cloneproof-check check &lt;repo-url&gt;</code><span>pre-registered · static · no code executed</span></div>
</div>`,
    `body{background:#0f1a2b;color:#f3f5f8}
.wrap{position:absolute;inset:0;padding:42px 52px;background:radial-gradient(900px 420px at 92% -10%,rgba(57,135,229,.35),transparent 60%),radial-gradient(600px 300px at -5% 110%,rgba(27,175,122,.22),transparent 60%)}
.eyebrow{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#9fb4cf;font-weight:600}
h1{font-size:38px;line-height:1.18;font-weight:700;letter-spacing:-.015em;margin-top:14px}
.stats{display:flex;gap:16px;margin-top:30px}
.stat{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 18px}
.stat b{display:block;font-size:30px;font-weight:700;color:#fff}
.stat span{font-size:14px;color:#c6d3e4}
.foot{position:absolute;left:52px;right:52px;bottom:30px;display:flex;justify-content:space-between;align-items:center;font-size:14px;color:#9fb4cf}
code{font-family:Consolas,"Cascadia Mono",monospace;font-size:16px;color:#e8eef6;background:rgba(255,255,255,.08);padding:6px 10px;border-radius:6px}`)
  };
}

const before = tally('run6-results.json', 'run6-judgments.json');
const after = tally('run6-fixes-results.json', 'run6-fixes-judgments.json');
const sample = fieldTest('run6-sample.json').sample;
const lockfiles = { 'npm only': 0, pnpm: 0, Yarn: 0, 'npm + pnpm': 0, Bun: 0, none: 0 };
for (const facts of sample) {
  const kinds = facts.lockfiles.map((file) => ({ 'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'yarn.lock': 'Yarn', 'pnpm-lock.yaml': 'pnpm', 'bun.lock': 'Bun', 'bun.lockb': 'Bun' }[file]));
  const unique = [...new Set(kinds)];
  if (unique.length === 0) lockfiles.none += 1;
  else if (unique.length > 1) lockfiles['npm + pnpm'] += 1;
  else if (unique[0] === 'npm') lockfiles['npm only'] += 1;
  else lockfiles[unique[0]] += 1;
}

const images = {
  cover: cover(before, after),
  'before-after': stackedBars({
    title: 'Every finding, judged: before and after the fixes',
    subtitle: 'Same 100 repositories, same pre-registered judging rules',
    rows: [
      { label: 'Blocking findings (fail CI)', bars: [{ label: 'v0.2.0', ...before.counts.failed }, { label: 'v0.2.4', ...after.counts.failed }] },
      { label: 'Warnings', bars: [{ label: 'v0.2.0', ...before.counts.warning }, { label: 'v0.2.4', ...after.counts.warning }] }
    ]
  }),
  'real-findings': simpleBars({
    title: 'What was real: 12 of 100 repositories',
    subtitle: 'Repositories with each kind of real setup finding (CloneProof v0.2.4)',
    color: COLORS.real,
    bars: [
      { label: 'npm test starts a real browser', value: 6 },
      { label: 'Tests the root npm test can’t run', value: 5 },
      { label: 'Stale npm lockfile next to pnpm’s', value: 1 }
    ],
    note: 'Tests root npm test can’t run: 3 workspace roots, plus shell (husky) and Dart (dart-sass) suites.'
  }),
  lockfiles: simpleBars({
    title: 'Root lockfiles in the top 100',
    subtitle: '29 of the 30 without one are published libraries, a deliberate choice counted as policy; none uses Bun',
    color: COLORS.real,
    bars: Object.entries(lockfiles).filter(([, value]) => value > 0).map(([label, value]) => ({ label, value }))
  })
};

fs.mkdirSync(outDir, { recursive: true });
for (const [name, image] of Object.entries(images)) {
  fs.writeFileSync(path.join(outDir, `${name}.html`), image.html);
  process.stdout.write(`${name} 1000x${image.height}\n`);
}
process.stdout.write(`${JSON.stringify({ before, after, lockfiles })}\n`);
