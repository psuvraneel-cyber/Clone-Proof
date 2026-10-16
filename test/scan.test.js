'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanRepository } = require('../src/scan/repository');

function makeRepository() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-scan-'));
}

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function writeHealthyRepository(root) {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'fixture-project',
    packageManager: 'npm@10.8.2',
    engines: { node: '>=22.0.0' },
    scripts: {
      build: 'node build.js',
      test: 'node --test'
    }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"fixture-project","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, 'README.md', [
    '# Fixture',
    '',
    '```bash',
    'npm ci',
    'npm test',
    'npm run build',
    'npm install',
    '```',
    ''
  ].join('\n'));
  writeFile(root, '.env.example', 'API_URL=https://example.invalid\nCLIENT_KEY=placeholder\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:22.19.0-bookworm-slim\n');
  writeFile(root, 'src/index.ts', [
    'export const api = process.env.API_URL;',
    'export const client = import.meta.env.CLIENT_KEY;'
  ].join('\n'));
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');
}

function withRepository(callback) {
  const root = makeRepository();
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

test('scans a healthy Node.js/TypeScript package', () => withRepository((root) => {
  writeHealthyRepository(root);

  const report = scanRepository(root);

  assert.equal(report.status, 'passed');
  assert.equal(report.scan.complete, true);
  assert.equal(report.project.type, 'typescript');
  assert.equal(report.project.packageManager, 'npm');
  assert.equal(report.project.packageManagerVersion, '10.8.2');
  assert.equal(report.project.runtime.nvmrc, '22.19.0');
  assert.deepEqual(report.project.runtime.dockerNode, ['22.19.0']);
  assert.equal(report.project.scripts.test, 'node --test');
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
  assert.equal(report.summary.skipped, 0);
}));

test('reports a missing package test script as a blocking finding', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  delete packageData.scripts.test;
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed');
}));

test('reports npm placeholder test scripts as a blocking finding', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.scripts.test = 'echo "Error: no test specified" && exit 1';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'README.md', 'Run `npm test` after installing dependencies.\n');

  const report = scanRepository(root);
  const placeholder = finding(report, 'TEST_SCRIPT_PLACEHOLDER');

  assert.equal(report.status, 'failed');
  assert.equal(placeholder.status, 'failed');
  assert.equal(placeholder.evidence.some((item) => item.path === 'README.md'), true);
  assert.equal(finding(report, 'TEST_SCRIPT_PRESENT'), undefined);
}));

test('reports an unknown npm script referenced by README', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'README.md', 'Run `npm run release` after installing dependencies.\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  const unknown = finding(report, 'README_SCRIPT_UNKNOWN');
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.message, /release/);
  assert.equal(unknown.evidence[0].path, 'README.md');
}));

test('warns when a referenced environment key is absent from the example', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, '.env.example', 'API_URL=https://example.invalid\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  const missing = finding(report, 'ENV_KEY_MISSING');
  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /CLIENT_KEY/);
  assert.equal(missing.evidence[0].path, 'src/index.ts');
}));

test('detects destructured, aliased, defaulted, quoted, and optional environment references', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, '.env.example', [
    'DATABASE_URL=placeholder',
    'API_KEY=placeholder',
    'OPTIONAL=placeholder',
    'QUOTED_KEY=placeholder',
    'MULTILINE=placeholder',
    'ALIASED=placeholder',
    'DEFAULTED=placeholder',
    'OPTIONAL_ENV=placeholder'
  ].join('\n'));
  writeFile(root, 'src/index.ts', [
    'const { DATABASE_URL, API_KEY: serviceKey, OPTIONAL = "fallback", \'QUOTED_KEY\': quoted = "fallback", ...rest } = process.env;',
    '({',
    '  MULTILINE,',
    '  ALIASED: alias,',
    '  DEFAULTED = "fallback",',
    '} = import.meta.env);',
    'const optional = process.env?.OPTIONAL_ENV;'
  ].join('\n'));

  const report = scanRepository(root);
  const documented = report.findings.filter((item) => item.code === 'ENV_KEY_DOCUMENTED');
  const documentedTitles = documented.map((item) => item.title).sort();

  assert.equal(report.status, 'passed');
  assert.deepEqual(documentedTitles, [
    'Environment key ALIASED is documented',
    'Environment key API_KEY is documented',
    'Environment key DATABASE_URL is documented',
    'Environment key DEFAULTED is documented',
    'Environment key MULTILINE is documented',
    'Environment key OPTIONAL is documented',
    'Environment key OPTIONAL_ENV is documented',
    'Environment key QUOTED_KEY is documented'
  ]);
  assert.equal(report.findings.some((item) => item.title.includes('REST')), false);
}));

test('ignores host environment variables and isolates nested packages', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'src/index.ts', 'export const path = process.env.PATH;\nexport const app = process.env.APP_SETTING;\n');
  writeFile(root, 'examples/nested/package.json', JSON.stringify({
    name: 'nested-fixture',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'examples/nested/src/index.ts', 'export const nested = process.env.NESTED_ONLY;\n');

  const report = scanRepository(root);
  const nested = finding(report, 'NESTED_PACKAGES_SKIPPED');

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(finding(report, 'ENV_KEY_MISSING').title.includes('APP_SETTING'), true);
  assert.equal(report.findings.some((item) => item.title.includes('PATH')), false);
  assert.equal(report.findings.some((item) => item.title.includes('NESTED_ONLY')), false);
  assert.equal(nested.status, 'skipped');
  assert.equal(nested.evidence[0].path, 'examples/nested/package.json');
}));

test('handles malformed package.json without executing or throwing', () => withRepository((root) => {
  writeFile(root, 'package.json', '{"name":');
  writeFile(root, 'src/index.js', 'module.exports = process.env.VALUE;\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(report.scan.complete, true);
  assert.equal(finding(report, 'PACKAGE_JSON_INVALID').status, 'failed');
}));

test('warns when a Node package has no lockfile', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'no-lock',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(finding(report, 'LOCKFILE_MISSING').status, 'warning');
}));

function writeNpmLockRepository(root, packageJson, lockfile) {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'lock-sync-fixture',
    scripts: { test: 'node --test' },
    ...packageJson
  }, null, 2));
  writeFile(root, 'package-lock.json', `${JSON.stringify(lockfile, null, 2)}\n`);
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');
}

test('fails when a v3 lockfile is missing a package.json dependency', () => withRepository((root) => {
  writeNpmLockRepository(root, { dependencies: { express: '^4.19.0' } }, {
    name: 'lock-sync-fixture',
    lockfileVersion: 3,
    packages: { '': { name: 'lock-sync-fixture', dependencies: {} } }
  });

  const report = scanRepository(root);
  const mismatch = finding(report, 'LOCKFILE_OUT_OF_SYNC');

  assert.equal(report.status, 'failed');
  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.message, /express/);
  assert.equal(mismatch.evidence.some((item) => item.path === 'package.json'), true);
  assert.equal(mismatch.evidence.some((item) => item.path === 'package-lock.json'), true);
}));

test('fails when a v3 lockfile has an extra root dependency', () => withRepository((root) => {
  writeNpmLockRepository(root, { dependencies: { express: '^4.19.0' } }, {
    name: 'lock-sync-fixture',
    lockfileVersion: 3,
    packages: { '': {
      name: 'lock-sync-fixture',
      dependencies: { express: '^4.19.0', lodash: '^4.17.21' }
    } }
  });

  const report = scanRepository(root);
  const mismatch = finding(report, 'LOCKFILE_OUT_OF_SYNC');

  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.message, /lodash/);
}));

test('fails when a v3 lockfile dependency specifier differs', () => withRepository((root) => {
  writeNpmLockRepository(root, { dependencies: { express: '^4.19.0' } }, {
    name: 'lock-sync-fixture',
    lockfileVersion: 3,
    packages: { '': {
      name: 'lock-sync-fixture',
      dependencies: { express: '^4.18.0' }
    } }
  });

  const report = scanRepository(root);
  const mismatch = finding(report, 'LOCKFILE_OUT_OF_SYNC');

  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.message, /express/);
}));

test('does not report an in-sync v3 lockfile', () => withRepository((root) => {
  writeNpmLockRepository(root, {
    dependencies: { express: '^4.19.0' },
    devDependencies: { tap: '^18.7.0' },
    optionalDependencies: { fsevents: '^2.3.3' }
  }, {
    name: 'lock-sync-fixture',
    lockfileVersion: 3,
    packages: { '': {
      name: 'lock-sync-fixture',
      dependencies: { express: '^4.19.0' },
      devDependencies: { tap: '^18.7.0' },
      optionalDependencies: { fsevents: '^2.3.3' }
    } }
  });

  const report = scanRepository(root);

  assert.equal(finding(report, 'LOCKFILE_OUT_OF_SYNC'), undefined);
  assert.notEqual(report.status, 'failed');
}));

test('fails when a v1 lockfile is missing a declared dependency', () => withRepository((root) => {
  writeNpmLockRepository(root, {
    dependencies: { express: '^4.19.0', lodash: '^4.17.21' }
  }, {
    name: 'lock-sync-fixture',
    lockfileVersion: 1,
    dependencies: { express: { version: '4.19.0' } }
  });

  const report = scanRepository(root);
  const mismatch = finding(report, 'LOCKFILE_OUT_OF_SYNC');

  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.message, /lodash/);
}));

test('fails when package-lock.json is malformed', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'bad-lock',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"lockfileVersion":');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'LOCKFILE_INVALID').status, 'failed');
}));

test('fails when packageManager disagrees with the root lockfile', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'mismatch',
    packageManager: 'pnpm@9.0.0',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"mismatch","lockfileVersion":3,"packages":{}}\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(finding(report, 'PACKAGE_MANAGER_LOCKFILE_MISMATCH').status, 'failed');
}));

test('warns when exact Node runtime declarations disagree', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'runtime-mismatch',
    engines: { node: '20.0.0' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"runtime-mismatch","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:20.0.0-bookworm-slim\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(finding(report, 'RUNTIME_VERSION_MISMATCH').status, 'warning');
}));

test('blocks an empty repository instead of reporting a false pass', () => withRepository((root) => {
  const report = scanRepository(root);

  assert.equal(report.status, 'blocked');
  assert.equal(finding(report, 'EMPTY_REPOSITORY').status, 'warning');
}));

test('blocks an unsupported repository type with a clear finding', () => withRepository((root) => {
  writeFile(root, 'README.md', '# Python project\n');
  writeFile(root, 'main.py', 'print("hello")\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'blocked');
  assert.equal(finding(report, 'UNSUPPORTED_ROOT').status, 'warning');
}));

test('returns an incomplete report for a missing repository path', () => {
  const missing = path.join(os.tmpdir(), `cloneproof-does-not-exist-${Date.now()}`);
  const report = scanRepository(missing);

  assert.equal(report.status, 'incomplete');
  assert.equal(finding(report, 'SCAN_ROOT_UNAVAILABLE').status, 'failed');
});

test('static inspection never executes package scripts, README commands, or Dockerfile instructions', () => withRepository((root) => {
  const marker = path.join(root, 'should-not-exist.marker');
  const markerCommand = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}', 'executed')"`;
  writeFile(root, 'package.json', JSON.stringify({
    name: 'untrusted-fixture',
    scripts: { test: markerCommand, postinstall: markerCommand }
  }, null, 2));
  writeFile(root, 'README.md', `Run \`${markerCommand}\`\n`);
  writeFile(root, 'Dockerfile', `FROM node:22.19.0-bookworm-slim\nRUN ${markerCommand}\n`);

  const report = scanRepository(root);

  assert.equal(fs.existsSync(marker), false);
  assert.equal(report.mode, 'check');
}));

test('skips symlinks without following them', (t) => withRepository((root) => {
  writeHealthyRepository(root);
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`);
  fs.writeFileSync(outside, 'process.env.SHOULD_NOT_BE_READ = "secret";\n');

  try {
    fs.symlinkSync(outside, path.join(root, 'linked.js'), 'file');
  } catch (error) {
    fs.rmSync(outside, { force: true });
    t.skip(`symlinks are unavailable: ${error.code || error.message}`);
    return;
  }

  try {
    const report = scanRepository(root);
    assert.equal(report.scan.complete, true);
    assert.ok(report.scan.skippedPaths.includes('linked.js'));
    assert.ok(!report.findings.some((item) => item.evidence.some((evidence) => evidence.path === 'linked.js')));
  } finally {
    fs.rmSync(outside, { force: true });
  }
}));

test('returns the same report for repeated scans', () => withRepository((root) => {
  writeHealthyRepository(root);

  const first = scanRepository(root);
  const second = scanRepository(root);

  assert.deepEqual(second, first);
  assert.match(first.scan.digest, /^[a-f0-9]{64}$/);
}));

test('marks a bounded scan incomplete and records skipped files', () => withRepository((root) => {
  writeHealthyRepository(root);

  const report = scanRepository(root, { maxFileBytes: 1 });

  assert.equal(report.status, 'incomplete');
  assert.equal(report.scan.complete, false);
  assert.ok(report.scan.skippedPaths.includes('package.json'));
  assert.deepEqual(report.scan.limits, {
    maxDepth: 25,
    maxFiles: 10000,
    maxFileBytes: 1,
    maxTotalBytes: 10 * 1024 * 1024
  });
}));
