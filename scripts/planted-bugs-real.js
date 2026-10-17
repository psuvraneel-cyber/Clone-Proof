'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');
const TARGETS = [
  ['cloneproof', 'https://github.com/psuvraneel-cyber/Clone-Proof'],
  ['class-validator', 'https://github.com/typestack/class-validator'],
  ['dotenv', 'https://github.com/motdotla/dotenv']
];

function write(root, relative, value) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}
function json(root, relative) { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
function writeJson(root, relative, value) { write(root, relative, `${JSON.stringify(value, null, 2)}\n`); }
function spawn(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function clone(url) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-real-base-'));
  fs.rmSync(root, { recursive: true, force: true });
  const result = spawn('git', ['clone', '--depth', '1', url, root], process.cwd());
  if (result.status !== 0) throw new Error(result.stderr);
  return root;
}
function copy(root) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-real-case-'));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(root, target, { recursive: true });
  return target;
}
function check(root) {
  const result = spawn(process.execPath, [CLI, 'check', root, '--format', 'json'], process.cwd());
  return JSON.parse(result.stdout);
}
function prepare(root, label) {
  const packageData = json(root, 'package.json');
  const hasDependencies = ['dependencies', 'devDependencies', 'optionalDependencies']
    .some((field) => Object.keys(packageData[field] || {}).length > 0);
  if (!hasDependencies) {
    packageData.devDependencies = { ...(packageData.devDependencies || {}), planted: '^1.0.0' };
    writeJson(root, 'package.json', packageData);
    const lock = json(root, 'package-lock.json');
    lock.packages[''] = lock.packages[''] || { name: packageData.name };
    lock.packages[''].devDependencies = { ...(lock.packages[''].devDependencies || {}), planted: '^1.0.0' };
    writeJson(root, 'package-lock.json', lock);
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (!/npm\s+run(?:-script)?\s+build/.test(readme)) write(root, 'README.md', `${readme}\nRun \`npm run build\`.\n`);
  if (!fs.existsSync(path.join(root, '.env.example'))) write(root, '.env.example', 'SAFE=placeholder\n');
  if (label === 'class-validator' && !packageData.engines?.node) {
    packageData.engines = { ...(packageData.engines || {}), node: '>=22.0.0' };
    writeJson(root, 'package.json', packageData);
  }
}

function mutations() {
  return [
    [1, 'lockfile out of sync', (r) => { const l = json(r, 'package-lock.json'); const root = l.packages['']; const field = Object.keys(root).find((key) => /Dependencies$/.test(key) && Object.keys(root[key] || {}).length); if (field) delete root[field][Object.keys(root[field])[0]]; writeJson(r, 'package-lock.json', l); }, ['LOCKFILE_OUT_OF_SYNC']],
    [2, 'test script missing', (r) => { const p = json(r, 'package.json'); delete p.scripts.test; writeJson(r, 'package.json', p); }, ['TEST_SCRIPT_MISSING']],
    [3, 'test placeholder', (r) => { const p = json(r, 'package.json'); p.scripts.test = 'echo "Error: no test specified" && exit 1'; writeJson(r, 'package.json', p); }, ['TEST_SCRIPT_PLACEHOLDER']],
    [4, 'README script unknown', (r) => { const p = json(r, 'package.json'); if (p.scripts.build) { p.scripts.compile = p.scripts.build; delete p.scripts.build; } writeJson(r, 'package.json', p); }, ['README_SCRIPT_UNKNOWN']],
    [5, 'environment key missing', (r) => write(r, 'src/planted-payment.js', 'module.exports = process.env.PAYMENT_API_KEY;\n'), ['ENV_KEY_MISSING']],
    [6, 'runtime mismatch', (r) => { const p = json(r, 'package.json'); p.engines = { ...(p.engines || {}), node: '>=22.0.0' }; writeJson(r, 'package.json', p); write(r, '.nvmrc', '20\n'); }, ['ENGINES_NODE_UNSATISFIED']],
    [7, 'ignored lockfile', (r) => write(r, '.gitignore', 'package-lock.json\n'), ['CORE_FILE_GITIGNORED']],
    [8, 'lockfile missing', (r) => fs.rmSync(path.join(r, 'package-lock.json'), { force: true }), ['LOCKFILE_MISSING']],
    [9, 'invalid package manifest', (r) => write(r, 'package.json', '{"name":\n'), ['PACKAGE_JSON_INVALID']],
    [10, 'private registry', (r) => write(r, '.npmrc', 'registry=https://npm.internal.example/\n_authToken=SECRET123\n'), ['PRIVATE_REGISTRY']],
    [11, 'README manager mismatch', (r) => write(r, 'README.md', fs.readFileSync(path.join(r, 'README.md'), 'utf8').replace(/npm\s+ci/g, 'yarn install --immutable')), ['README_PACKAGE_MANAGER_MISMATCH']],
    [12, 'package manager mismatch', (r) => { const p = json(r, 'package.json'); p.packageManager = 'pnpm@9.0.0'; writeJson(r, 'package.json', p); }, ['PACKAGE_MANAGER_LOCKFILE_MISMATCH']],
    [13, 'README whitespace control', (r) => write(r, 'README.md', `${fs.readFileSync(path.join(r, 'README.md'), 'utf8')}\n`), []]
  ];
}

const results = [];
for (const [label, url] of TARGETS) {
  const base = clone(url);
  try {
    prepare(base, label);
    const baseCodes = check(base).findings.map((finding) => finding.code);
    for (const [number, name, mutate, expected] of mutations()) {
      const root = copy(base);
      try {
        mutate(root);
        const report = check(root);
        const codes = report.findings.map((finding) => finding.code);
        const detected = expected.length === 0
          ? JSON.stringify(codes) === JSON.stringify(baseCodes)
          : expected.every((code) => codes.includes(code));
        if (number === 10 && JSON.stringify(report).includes('SECRET123')) throw new Error('secret leaked');
        results.push({ repository: label, bug: number, name, detected, status: report.status, findingCodes: codes });
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

const summary = { detected: results.filter((item) => item.detected).length, total: results.length, results };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.detected !== summary.total) process.exitCode = 1;
