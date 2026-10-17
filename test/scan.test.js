'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { classifyLstatFailure, scanRepository } = require('../src/scan/repository');
const { exitCodeForReport, renderHtml, renderJson, renderText } = require('../src/report/render');
const { CHECK_GROUPS, NOT_CHECKED } = require('../src/report/coverage');

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

test('warns when browser test tooling is used through an npm test script indirection', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.devDependencies = {
    '@playwright/test': '^1.50.0',
    '@vitest/browser': '^2.1.0',
    '@vitest/browser-playwright': '^2.1.0',
    '@web/test-runner': '^0.19.0',
    cypress: '^13.0.0',
    karma: '^6.4.0',
    playwright: '^1.50.0',
    puppeteer: '^23.0.0'
  };
  packageData.scripts.test = 'npm run test:browser';
  packageData.scripts['test:browser'] = 'vitest --browser';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: packageData.name,
    lockfileVersion: 3,
    packages: { '': { name: packageData.name, devDependencies: packageData.devDependencies } }
  }, null, 2)}\n`);

  const report = scanRepository(root);
  const browserFinding = finding(report, 'BROWSER_TESTS_DETECTED');

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(browserFinding.status, 'warning');
  assert.equal(browserFinding.severity, 'warning');
  assert.match(browserFinding.message, /vitest/);
  assert.match(browserFinding.message, /@playwright\/test/);
  assert.ok(browserFinding.evidence.some((item) => item.path === 'package.json'));
  assert.equal(browserFinding.evidence.every((item) => item.path === 'package.json'), true);
}));

test('does not warn for browser tooling that is not part of the package test command', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.devDependencies = { playwright: '^1.50.0' };
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: packageData.name,
    lockfileVersion: 3,
    packages: { '': { name: packageData.name, devDependencies: packageData.devDependencies } }
  }, null, 2)}\n`);

  const report = scanRepository(root);

  assert.equal(finding(report, 'BROWSER_TESTS_DETECTED'), undefined);
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

test('recognizes bare npm i as a README install command', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'README.md', 'Install dependencies with `npm i`.\n');

  const report = scanRepository(root);
  const install = finding(report, 'README_INSTALL_COMMAND');

  assert.equal(install.status, 'passed');
  assert.equal(install.evidence[0].path, 'README.md');
  assert.match(install.message, /npm install/);
}));

test('validates npm start against scripts.start or a root server.js', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.scripts.start = 'node src/server.js';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'README.md', 'Start the app with `npm start`.\n');

  const scripted = scanRepository(root);
  assert.equal(finding(scripted, 'README_SCRIPT_UNKNOWN'), undefined);
  assert.equal(finding(scripted, 'README_SCRIPT_REFERENCE').status, 'passed');

  delete packageData.scripts.start;
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'server.js', 'console.log("server");\n');

  const serverFile = scanRepository(root);
  assert.equal(finding(serverFile, 'README_SCRIPT_UNKNOWN'), undefined);
  assert.equal(finding(serverFile, 'README_SCRIPT_REFERENCE').status, 'passed');

  fs.rmSync(path.join(root, 'server.js'));
  const unknown = scanRepository(root);
  const unknownStart = finding(unknown, 'README_SCRIPT_UNKNOWN');
  assert.equal(unknownStart.status, 'failed');
  assert.equal(unknownStart.evidence[0].path, 'README.md');
  assert.match(unknownStart.message, /npm start/);
}));

test('checks npm run-script, yarn run, and pnpm run against package scripts', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.scripts.release = 'node release.js';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));

  for (const manager of ['npm', 'yarn', 'pnpm']) {
    const runCommand = manager === 'npm' ? 'npm run-script release' : `${manager} run release`;
    writeFile(root, 'README.md', `Run \`${runCommand}\`.\n`);
    const valid = scanRepository(root);
    assert.equal(finding(valid, 'README_SCRIPT_REFERENCE').status, 'passed', manager);
    assert.equal(finding(valid, 'README_SCRIPT_UNKNOWN'), undefined, manager);

    writeFile(root, 'README.md', `Run \`${manager === 'npm' ? 'npm run-script missing' : `${manager} run missing`}\`.\n`);
    const invalid = scanRepository(root);
    const unknown = finding(invalid, 'README_SCRIPT_UNKNOWN');
    assert.equal(unknown.status, 'failed', manager);
    assert.equal(unknown.evidence[0].path, 'README.md', manager);
  }
}));

test('does not treat bare yarn or pnpm commands as script checks', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'README.md', [
    'Run `yarn test` for tests.',
    'Run `pnpm build` to build the app.'
  ].join('\n'));

  const report = scanRepository(root);

  assert.equal(finding(report, 'README_SCRIPT_UNKNOWN'), undefined);
  assert.equal(finding(report, 'README_SCRIPT_REFERENCE'), undefined);
}));

test('warns on a README setup manager mismatch and suppresses it with a correct setup command', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'README.md', [
    '```bash',
    'yarn install --immutable',
    '```'
  ].join('\n'));

  const mismatch = scanRepository(root);
  const warning = finding(mismatch, 'README_PACKAGE_MANAGER_MISMATCH');
  assert.equal(warning.status, 'warning');
  assert.equal(warning.evidence[0].path, 'README.md');
  assert.match(warning.message, /yarn/);
  assert.match(warning.message, /npm/);

  writeFile(root, 'README.md', [
    '```bash',
    'yarn install --immutable',
    'npm ci --ignore-scripts',
    '```'
  ].join('\n'));
  const suppressed = scanRepository(root);
  assert.equal(finding(suppressed, 'README_PACKAGE_MANAGER_MISMATCH'), undefined);
}));

test('limits README package-manager mismatch checks to setup forms and ignores consumer commands', () => withRepository((root) => {
  writeHealthyRepository(root);
  const cases = [
    ['yarn add axios', false],
    ['pnpm add axios', false],
    ['npm install axios', false],
    ['yarn test', false],
    ['pnpm build', false],
    ['yarn --immutable', true],
    ['pnpm i --frozen-lockfile', true],
    ['npm ci --ignore-scripts', false]
  ];

  for (const [command, shouldWarn] of cases) {
    writeFile(root, 'README.md', `\`${command}\`\n`);
    const report = scanRepository(root);
    assert.equal(Boolean(finding(report, 'README_PACKAGE_MANAGER_MISMATCH')), shouldWarn, command);
  }
}));

test('treats root .npmrc as a core file and reports only sorted private hosts', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.dependencies = {
    privateGit: 'git+https://git-user:git-password@git.example.invalid/team/pkg.git?token=git-token',
    privateSsh: 'git+ssh://ssh-user:ssh-password@ssh.example.invalid/team/pkg.git'
  };
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, '.npmrc', [
    'registry=https://npm-user:npm-password@z-registry.example.invalid/npm/',
    '@scope:registry=https://a-registry.example.invalid/npm/',
    'registry=https://registry.npmjs.org/',
    '@public:registry=https://registry.yarnpkg.com/',
    '_authToken=do-not-report-this-token',
    'username=do-not-report-this-username',
    'password=do-not-report-this-password'
  ].join('\n'));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: packageData.name,
    lockfileVersion: 3,
    packages: {
      '': { name: packageData.name, dependencies: packageData.dependencies },
      'node_modules/private': {
        version: '1.0.0',
        resolved: 'https://lock-user:lock-password@lock.example.invalid/private.tgz?token=lock-token'
      }
    }
  }, null, 2)}\n`);

  assert.equal(require('../src/scan/repository').isCoreFile('.npmrc'), true);
  const report = scanRepository(root);
  const privateRegistry = finding(report, 'PRIVATE_REGISTRY');

  assert.equal(privateRegistry.status, 'warning');
  assert.match(privateRegistry.message, /a-registry\.example\.invalid, git\.example\.invalid, lock\.example\.invalid, ssh\.example\.invalid, z-registry\.example\.invalid/);
  for (const secret of [
    'npm-user', 'npm-password', 'git-user', 'git-password', 'ssh-user', 'ssh-password',
    'lock-user', 'lock-password', 'do-not-report-this-token', 'do-not-report-this-username',
    'do-not-report-this-password', 'git-token', 'lock-token'
  ]) {
    assert.equal(JSON.stringify(report).includes(secret), false, secret);
  }

  const outputs = [
    renderJson(report),
    renderText(report, { color: false, isTTY: false }),
    renderHtml(report)
  ];
  for (const output of outputs) {
    assert.match(output, /a-registry\.example\.invalid/);
    assert.doesNotMatch(output, /npm-user|npm-password|git-user|git-password|ssh-user|ssh-password|lock-user|lock-password|do-not-report-this|git-token|lock-token/);
  }
}));

test('caps private registry host reporting at ten sorted hosts', () => withRepository((root) => {
  writeHealthyRepository(root);
  const entries = Array.from({ length: 12 }, (_, index) => `@scope${index}:registry=https://registry-${String(index).padStart(2, '0')}.example.invalid/`);
  writeFile(root, '.npmrc', entries.join('\n'));

  const report = scanRepository(root);
  const privateRegistry = finding(report, 'PRIVATE_REGISTRY');

  assert.equal(privateRegistry.status, 'warning');
  assert.match(privateRegistry.message, /registry-00\.example\.invalid/);
  assert.match(privateRegistry.message, /registry-09\.example\.invalid/);
  assert.doesNotMatch(privateRegistry.message, /registry-10\.example\.invalid|registry-11\.example\.invalid/);
  assert.match(privateRegistry.message, /and 2 more/);
}));

test('does not warn for public npm and Yarn registry hosts', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, '.npmrc', [
    'registry=https://registry.npmjs.org/',
    '@scope:registry=https://registry.yarnpkg.com/'
  ].join('\n'));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: 'fixture-project',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-project' },
      'node_modules/public': { version: '1.0.0', resolved: 'https://registry.npmjs.org/public/-/public-1.0.0.tgz' }
    }
  }, null, 2)}\n`);

  const report = scanRepository(root);

  assert.equal(finding(report, 'PRIVATE_REGISTRY'), undefined);
}));

test('warns when a declared build output is missing and README omits npm run build', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.main = 'dist/index.js';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'README.md', 'Run `npm ci` and `npm test`.\n');

  const report = scanRepository(root);
  const missing = finding(report, 'BUILD_OUTPUT_MISSING');

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /dist\/index\.js/);
}));

test('does not warn about a missing build output when README documents npm run build', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.main = 'dist/index.js';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'README.md', 'Run `npm ci`, `npm test`, and `npm run build`.\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'BUILD_OUTPUT_MISSING'), undefined);
}));

test('does not warn when a declared build output file exists', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.main = 'dist/index.js';
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'dist/index.js', 'module.exports = 1;\n');
  writeFile(root, 'README.md', 'Run `npm ci` and `npm test`.\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'BUILD_OUTPUT_MISSING'), undefined);
}));

test('reports likely service requirements from compose files and dependency names', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'docker-compose.yml', 'services:\n  db:\n    image: postgres\n');

  const composeReport = scanRepository(root);
  const composeFinding = finding(composeReport, 'SERVICES_LIKELY_REQUIRED');
  assert.equal(composeFinding.status, 'skipped');
  assert.equal(composeFinding.severity, 'info');
  assert.match(composeFinding.message, /docker-compose\.yml/);

  for (const dependency of ['pg', 'mysql2', 'mongoose', 'mongodb', 'redis', 'ioredis', 'amqplib']) {
    const dependencyRoot = makeRepository();
    try {
      writeHealthyRepository(dependencyRoot);
      const packageData = JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'package.json'), 'utf8'));
      packageData.dependencies = { [dependency]: '^1.0.0' };
      writeFile(dependencyRoot, 'package.json', JSON.stringify(packageData, null, 2));
      const lockfile = JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'package-lock.json'), 'utf8'));
      lockfile.packages[''] = { name: packageData.name };
      lockfile.packages[''].dependencies = { [dependency]: '^1.0.0' };
      writeFile(dependencyRoot, 'package-lock.json', JSON.stringify(lockfile, null, 2));

      const report = scanRepository(dependencyRoot);
      const serviceFinding = finding(report, 'SERVICES_LIKELY_REQUIRED');
      assert.equal(serviceFinding.status, 'skipped', dependency);
      assert.equal(serviceFinding.severity, 'info', dependency);
      assert.match(serviceFinding.message, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), dependency);
    } finally {
      fs.rmSync(dependencyRoot, { recursive: true, force: true });
    }
  }
}));

test('does not report likely services for a project without compose or service dependencies', () => withRepository((root) => {
  writeHealthyRepository(root);

  const report = scanRepository(root);

  assert.equal(finding(report, 'SERVICES_LIKELY_REQUIRED'), undefined);
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

function writeEnvironmentFixture(root, source) {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'environment-fixture',
    scripts: { test: 'node --test' }
  }));
  writeFile(root, 'package-lock.json', '{"name":"environment-fixture","lockfileVersion":3,"packages":{"":{"name":"environment-fixture"}}}\n');
  writeFile(root, 'index.js', source);
}

test('filters environment warnings by tooling, example, fixture, and root config path', () => {
  const cases = [
    ['scripts/build.js', false],
    ['examples/a.js', false],
    ['test/fixtures/x.js', false],
    ['rollup.config.js', false],
    ['src/index.js', true],
    ['src/scripts/x.js', true]
  ];

  for (const [relativePath, shouldWarn] of cases) {
    withRepository((root) => {
      writeEnvironmentFixture(root, 'console.log("fixture");\n');
      writeFile(root, relativePath, 'const value = process.env.TOOLING_ONLY;\n');

      const report = scanRepository(root);
      const missing = finding(report, 'ENV_EXAMPLE_MISSING');

      assert.equal(report.scan.fileCount, 4, relativePath);
      assert.equal(report.scan.discoveredFileCount, 4, relativePath);
      assert.equal(Boolean(missing), shouldWarn, relativePath);
      if (shouldWarn) {
        assert.equal(missing.evidence[0].path, relativePath);
      } else {
        assert.equal(report.findings
          .filter((item) => item.code.startsWith('ENV_'))
          .some((item) => item.evidence.some((evidence) => evidence.path === relativePath)), false);
      }
    });
  }
});

test('treats CLICOLOR_FORCE as a conventional environment key', () => withRepository((root) => {
  writeEnvironmentFixture(root, 'console.log("fixture");\n');
  writeFile(root, 'lib/command.js', 'const forceColor = process.env.CLICOLOR_FORCE;\n');

  const report = scanRepository(root);

  assert.equal(report.scan.fileCount, 4);
  assert.equal(finding(report, 'ENV_EXAMPLE_MISSING'), undefined);
  assert.equal(finding(report, 'ENV_KEY_MISSING'), undefined);
}));

test('does not treat an earlier object destructuring as environment access', () => withRepository((root) => {
  writeEnvironmentFixture(root, [
    "const { join, resolve } = require('path');",
    'const { PORT, DATABASE_URL } = process.env;'
  ].join('\n'));

  const report = scanRepository(root);
  const missing = finding(report, 'ENV_EXAMPLE_MISSING');

  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /DATABASE_URL, PORT/);
  assert.doesNotMatch(missing.message, /join|resolve/);
  assert.equal(report.findings.some((item) => item.title.includes('join')), false);
  assert.equal(report.findings.some((item) => item.title.includes('resolve')), false);
}));

test('finds destructuring after a function and inside a function body', () => withRepository((root) => {
  writeEnvironmentFixture(root, [
    'function before() { return 1; }',
    'const { AFTER_FUNCTION } = process.env;',
    'function read() {',
    '  const { INSIDE_FUNCTION } = import.meta.env;',
    '  return INSIDE_FUNCTION;',
    '}'
  ].join('\n'));

  const report = scanRepository(root);
  const missing = finding(report, 'ENV_EXAMPLE_MISSING');

  assert.match(missing.message, /AFTER_FUNCTION/);
  assert.match(missing.message, /INSIDE_FUNCTION/);
}));

test('finds multiline, assignment-form, nested, quoted, defaulted, and spread destructuring keys', () => withRepository((root) => {
  writeEnvironmentFixture(root, [
    'function read() {',
    '  const {',
    '    MULTILINE,',
    '    ALIASED: localAlias,',
    '    DEFAULTED = "fallback",',
    '    "QUOTED_KEY": quoted,',
    '    NESTED: { ignored },',
    '    ARRAY: [alsoIgnored],',
    '    ...rest',
    '  } = process.env;',
    '  ({ ASSIGNED } = import.meta.env);',
    '}'
  ].join('\n'));

  const report = scanRepository(root);
  const missing = finding(report, 'ENV_EXAMPLE_MISSING');

  for (const key of ['ALIASED', 'ASSIGNED', 'DEFAULTED', 'MULTILINE', 'NESTED', 'QUOTED_KEY']) {
    assert.match(missing.message, new RegExp(key));
  }
  assert.doesNotMatch(missing.message, /ignored|alsoIgnored|rest|localAlias/);
}));

test('does not infer environment keys from ordinary object literals or aliases', () => withRepository((root) => {
  writeEnvironmentFixture(root, 'const obj = { a: 1 };\nconst env = process.env;\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENV_EXAMPLE_MISSING'), undefined);
  assert.equal(finding(report, 'ENV_KEY_MISSING'), undefined);
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

test('warns when a core lockfile is ignored by local Git rules', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'ignored-lock', scripts: { test: 'node --test' } }));
  writeFile(root, 'package-lock.json', '{"name":"ignored-lock","lockfileVersion":3,"packages":{"":{"name":"ignored-lock"}}}\n');
  writeFile(root, '.gitignore', 'package-lock.json\n');

  const report = scanRepository(root);
  const warning = finding(report, 'CORE_FILE_GITIGNORED');

  assert.equal(report.status, 'passed_with_warnings');
  assert.equal(warning.status, 'warning');
  assert.equal(warning.evidence[0].path, 'package-lock.json');
  assert.match(warning.message, /matches an ignore rule; unless it is already tracked, a fresh clone will not contain it/);
  assert.match(warning.recommendation, /git ls-files package-lock\.json/);
  assert.equal(finding(report, 'LOCKFILE_PRESENT').status, 'passed');
}));

test('supports gitignore negation for environment templates', () => withRepository((root) => {
  writeEnvironmentFixture(root, 'const value = process.env.API_URL;\n');
  writeFile(root, '.gitignore', '.env*\n!.env.example\n');
  writeFile(root, '.env.example', 'API_URL=placeholder\n');
  writeFile(root, '.env.local', 'API_URL=secret\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'CORE_FILE_GITIGNORED'), undefined);
  assert.equal(finding(report, 'ENV_KEY_DOCUMENTED').status, 'passed');
  assert.ok(report.scan.skippedPaths.includes('.env.local'));
  assert.ok(!report.scan.skippedPaths.includes('.env.example'));
}));

test('documents environment keys with an optional export prefix', () => withRepository((root) => {
  writeEnvironmentFixture(root, 'const value = process.env.API_URL;\n');
  writeFile(root, '.env.example', 'export API_URL=https://example.invalid\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENV_KEY_DOCUMENTED').status, 'passed');
  assert.equal(finding(report, 'ENV_KEY_DOCUMENTED').evidence[1].line, 1);
}));

test('skips ignored directories without reporting nested packages', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'ignored-directory', scripts: { test: 'node --test' } }));
  writeFile(root, 'package-lock.json', '{"name":"ignored-directory","lockfileVersion":3,"packages":{"":{"name":"ignored-directory"}}}\n');
  writeFile(root, '.gitignore', 'build/\n');
  writeFile(root, 'build/package.json', '{"name":"ignored-nested"}\n');
  writeFile(root, 'build/index.js', 'process.env.IGNORED;\n');

  const report = scanRepository(root);

  assert.ok(report.scan.skippedPaths.includes('build'));
  assert.equal(finding(report, 'NESTED_PACKAGES_SKIPPED'), undefined);
}));

test('supports anchored and unanchored directory patterns', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'ignore-anchor', scripts: { test: 'node --test' } }));
  writeFile(root, '.gitignore', '/out\n');
  writeFile(root, 'out/root.txt', 'root\n');
  writeFile(root, 'nested/out/child.txt', 'child\n');

  const anchored = scanRepository(root);
  assert.ok(anchored.scan.skippedPaths.includes('out'));
  assert.ok(!anchored.scan.skippedPaths.includes('nested/out'));

  writeFile(root, '.gitignore', 'out\n');
  const unanchored = scanRepository(root);
  assert.ok(unanchored.scan.skippedPaths.includes('out'));
  assert.ok(unanchored.scan.skippedPaths.includes('nested/out'));
}));

test('supports double-star directory patterns', () => withRepository((root) => {
  writeFile(root, '.gitignore', '**/tmp\n');
  writeFile(root, 'tmp/root.txt', 'root\n');
  writeFile(root, 'a/b/tmp/nested.txt', 'nested\n');

  const report = scanRepository(root);

  assert.ok(report.scan.skippedPaths.includes('tmp'));
  assert.ok(report.scan.skippedPaths.includes('a/b/tmp'));
}));

test('supports comments, escaped prefixes, wildcards, and character classes', () => withRepository((root) => {
  writeFile(root, '.gitignore', [
    '# comment',
    '\\#literal.txt',
    '\\!literal.txt',
    '*.log',
    'file?.txt',
    '[ab].txt'
  ].join('\n'));
  for (const name of ['#literal.txt', '!literal.txt', 'debug.log', 'file1.txt', 'a.txt']) {
    writeFile(root, name, 'ignored\n');
  }
  writeFile(root, 'keep.txt', 'kept\n');

  const report = scanRepository(root);

  for (const name of ['#literal.txt', '!literal.txt', 'debug.log', 'file1.txt', 'a.txt']) {
    assert.ok(report.scan.skippedPaths.includes(name), name);
  }
  assert.ok(!report.scan.skippedPaths.includes('keep.txt'));
}));

test('reads a bounded regular .git/info/exclude file for local scans', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'exclude-fixture', scripts: { test: 'node --test' } }));
  writeFile(root, '.git/info/exclude', 'excluded/\n');
  writeFile(root, 'excluded/data.txt', 'ignored\n');

  const report = scanRepository(root);

  assert.ok(report.scan.skippedPaths.includes('excluded'));
}));

test('freshClone disables local ignore rules and core-file warnings', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'fresh-clone', scripts: { test: 'node --test' } }));
  writeFile(root, 'package-lock.json', '{"name":"fresh-clone","lockfileVersion":3,"packages":{"":{"name":"fresh-clone"}}}\n');
  writeFile(root, '.gitignore', 'package-lock.json\nbuild/\n');
  writeFile(root, 'build/package.json', '{"name":"nested-build"}\n');

  const report = scanRepository(root, { freshClone: true });

  assert.equal(finding(report, 'CORE_FILE_GITIGNORED'), undefined);
  assert.ok(!report.scan.skippedPaths.includes('build'));
  assert.equal(finding(report, 'NESTED_PACKAGES_SKIPPED').status, 'skipped');
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

test('keeps a core-js-only install-script check informational and passed', () => withRepository((root) => {
  writeHealthyRepository(root);
  const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  packageData.dependencies = { 'core-js': '^3.39.0' };
  writeFile(root, 'package.json', JSON.stringify(packageData, null, 2));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: packageData.name,
    lockfileVersion: 3,
    packages: {
      '': { name: packageData.name, dependencies: packageData.dependencies },
      'node_modules/core-js': { version: '3.39.0', hasInstallScript: true }
    }
  }, null, 2)}\n`);

  const report = scanRepository(root);
  const skipped = finding(report, 'INSTALL_SCRIPTS_SKIPPED');

  assert.equal(report.status, 'passed');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.severity, 'info');
}));

test('skips npm v2/v3 packages whose install scripts Docker verification skips', () => withRepository((root) => {
  const packageNames = Array.from({ length: 25 }, (_, index) => `native-${String(index + 1).padStart(2, '0')}`);
  const packages = Object.fromEntries([
    ['', { name: 'install-script-fixture' }],
    ...[...packageNames].reverse().map((name) => [
      `node_modules/${name}`,
      { version: '1.0.0', hasInstallScript: true }
    ]),
    ['node_modules/no-install-script', { version: '1.0.0', hasInstallScript: false }]
  ]);

  writeFile(root, 'package.json', JSON.stringify({
    name: 'install-script-fixture',
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');

  for (const lockfileVersion of [2, 3]) {
    writeFile(root, 'package-lock.json', `${JSON.stringify({
      name: 'install-script-fixture',
      lockfileVersion,
      packages
    }, null, 2)}\n`);

    const report = scanRepository(root);
    const skipped = finding(report, 'INSTALL_SCRIPTS_SKIPPED');
    const visibleNames = packageNames.slice(0, 20);

    assert.equal(report.status, 'passed');
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.severity, 'info');
    assert.match(skipped.message, new RegExp(`Affected packages: ${visibleNames.join(', ')}`));
    assert.match(skipped.message, /and 5 more/);
    assert.doesNotMatch(skipped.message, /native-21, native-22/);
    assert.doesNotMatch(skipped.message, /no-install-script/);
  }
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

test('warns when major Node runtime declarations disagree', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'major-runtime-mismatch',
    engines: { node: '>=18' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"major-runtime-mismatch","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '22\n');
  writeFile(root, 'Dockerfile', 'FROM node:18-alpine\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'RUNTIME_VERSION_MISMATCH').status, 'warning');
}));

test('does not warn when a partial Docker tag agrees by major version', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'major-runtime-match',
    engines: { node: '>=22' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"major-runtime-match","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:22-bookworm-slim\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'RUNTIME_VERSION_MISMATCH'), undefined);
}));

test('includes .node-version in runtime declarations', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, '.node-version', '22.19.0\n');

  const report = scanRepository(root);

  assert.equal(report.project.runtime.nodeVersion, '22.19.0');
  assert.equal(finding(report, 'NODE_VERSION_PRESENT').status, 'passed');
}));

test('ignores runtime aliases that cannot be pinned', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'runtime-alias',
    engines: { node: 'lts/*' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"runtime-alias","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', 'lts/*\n');
  writeFile(root, 'Dockerfile', 'FROM node:latest\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'RUNTIME_VERSION_MISMATCH'), undefined);
  assert.equal(finding(report, 'ENGINES_NODE_UNSATISFIED'), undefined);
}));

test('warns when a pinned runtime does not satisfy engines.node', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'engine-unsatisfied',
    engines: { node: '>=22' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"engine-unsatisfied","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '20\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENGINES_NODE_UNSATISFIED').status, 'warning');
}));

function writeEngineFixture(root, pinned, range, dockerfile) {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'engine-range-fixture',
    engines: { node: range },
    scripts: { test: 'node --test' }
  }));
  writeFile(root, 'package-lock.json', '{"name":"engine-range-fixture","lockfileVersion":3,"packages":{"":{"name":"engine-range-fixture"}}}\n');
  writeFile(root, '.nvmrc', `${pinned}\n`);
  if (dockerfile) writeFile(root, 'Dockerfile', dockerfile);
}

test('treats partial runtime pins as existential version prefixes for engine ranges', () => withRepository((root) => {
  const cases = [
    ['22', '>=22.19.0', false],
    ['22', '>=24', true],
    ['22', '^20', true],
    ['22', '^22.5.0', false],
    ['22', '<22.0.0', true],
    ['22', '>=20 <23', false],
    ['22.18', '>=22.19.0', true],
    ['22.18', '>22.18.0', false],
    ['22.18', '<22.18.0', true],
    ['22.18', '<=22.18.0', false],
    ['22.18', '^22.19.0', true],
    ['22.18', '~22.18.5', false],
    ['22.18.0', '>=22.19.0', true]
  ];

  for (const [pinned, range, warningExpected] of cases) {
    writeEngineFixture(root, pinned, range);
    const report = scanRepository(root);
    assert.equal(Boolean(finding(report, 'ENGINES_NODE_UNSATISFIED')), warningExpected, `${pinned} vs ${range}`);
  }
}));

test('applies partial runtime-prefix semantics to Docker Node tags', () => withRepository((root) => {
  writeEngineFixture(root, '22.19.0', '>=22.19.0', 'FROM node:22-bookworm-slim\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENGINES_NODE_UNSATISFIED'), undefined);
}));

test('treats npm greater-than engine ranges as the next complete release', () => withRepository((root) => {
  const cases = [
    ['22', '>22', true],
    ['23', '>22', false],
    ['22.18', '>22.18', true],
    ['22.19', '>22.18', false]
  ];

  for (const [pinned, range, warningExpected] of cases) {
    writeEngineFixture(root, pinned, range);
    const report = scanRepository(root);
    assert.equal(Boolean(finding(report, 'ENGINES_NODE_UNSATISFIED')), warningExpected, `${pinned} vs ${range}`);
  }
}));

test('accepts an engines alternative that includes the pinned runtime', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'engine-alternatives',
    engines: { node: '^20 || ^22' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"engine-alternatives","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '22\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENGINES_NODE_UNSATISFIED'), undefined);
}));

test('skips unsupported engine range syntax without a false finding', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'engine-unknown',
    engines: { node: '20 - 22' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', '{"name":"engine-unknown","lockfileVersion":3,"packages":{}}\n');
  writeFile(root, '.nvmrc', '18\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENGINES_NODE_UNSATISFIED'), undefined);
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

test('blocks a Python repository that only contains JavaScript assets', () => withRepository((root) => {
  writeFile(root, 'pyproject.toml', '[project]\nname = "asset-app"\n');
  writeFile(root, 'static/js/app.js', 'console.log("asset");\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'blocked');
  assert.equal(report.project.type, 'unsupported');
  assert.equal(finding(report, 'PACKAGE_JSON_MISSING'), undefined);
  assert.equal(finding(report, 'UNSUPPORTED_ROOT').status, 'warning');
}));

test('classifies a Python app directory with JavaScript assets as unsupported', () => withRepository((root) => {
  writeFile(root, 'requirements.txt', 'Django==5.0\n');
  writeFile(root, 'app/__init__.py', '');
  writeFile(root, 'app/static/js/main.js', 'console.log("asset");\n');

  const report = scanRepository(root);
  const unsupported = finding(report, 'UNSUPPORTED_ROOT');

  assert.equal(report.status, 'blocked');
  assert.equal(exitCodeForReport(report), 2);
  assert.equal(report.project.type, 'unsupported');
  assert.equal(finding(report, 'PACKAGE_JSON_MISSING'), undefined);
  assert.match(unsupported.message, /Python/);
  assert.equal(unsupported.evidence[0].path, 'requirements.txt');
}));

test('classifies a Django layout as unsupported before considering JavaScript assets', () => withRepository((root) => {
  writeFile(root, 'manage.py', 'print("django");\n');
  writeFile(root, 'requirements.txt', 'Django==5.0\n');
  writeFile(root, 'static/js/x.js', 'console.log("asset");\n');
  writeFile(root, 'tsconfig.json', '{}\n');

  const report = scanRepository(root);

  assert.equal(report.project.type, 'unsupported');
  assert.equal(finding(report, 'UNSUPPORTED_ROOT').evidence[0].path, 'requirements.txt');
  assert.equal(finding(report, 'PACKAGE_JSON_MISSING'), undefined);
}));

test('a root package.json takes precedence over an ecosystem marker', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({ name: 'node-root', scripts: { test: 'node --test' } }));
  writeFile(root, 'package-lock.json', '{"name":"node-root","lockfileVersion":3,"packages":{"":{"name":"node-root"}}}\n');
  writeFile(root, 'requirements.txt', 'flask\n');

  const report = scanRepository(root);

  assert.equal(report.project.type, 'node');
  assert.equal(finding(report, 'UNSUPPORTED_ROOT'), undefined);
}));

test('blocks a Go repository with JavaScript only in documentation', () => withRepository((root) => {
  writeFile(root, 'go.mod', 'module example.invalid/app\n\ngo 1.22\n');
  writeFile(root, 'docs/example.js', 'console.log("documentation");\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'blocked');
  assert.equal(report.project.type, 'unsupported');
  assert.equal(finding(report, 'UNSUPPORTED_ROOT').status, 'warning');
}));

test('keeps a root JavaScript project without package.json in the Node checks', () => withRepository((root) => {
  writeFile(root, 'index.js', 'console.log("root app");\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'failed');
  assert.equal(report.project.type, 'node');
  assert.equal(finding(report, 'PACKAGE_JSON_MISSING').status, 'failed');
}));

test('blocks a repository whose Node package is nested under another ecosystem', () => withRepository((root) => {
  writeFile(root, 'backend/requirements.txt', 'flask==3.0.0\n');
  writeFile(root, 'frontend/package.json', JSON.stringify({ name: 'frontend' }, null, 2));

  const report = scanRepository(root);
  const unsupported = finding(report, 'UNSUPPORTED_ROOT');

  assert.equal(report.status, 'blocked');
  assert.equal(report.project.type, 'unsupported');
  assert.match(unsupported.recommendation, /nested package/i);
}));

test('unsupported reports list only the static groups that were attempted', () => withRepository((root) => {
  writeFile(root, 'README.md', '# Python project\n');
  writeFile(root, 'main.py', 'print("hello")\n');

  const report = scanRepository(root);

  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.coverage, {
    checked: [CHECK_GROUPS.NESTED_PACKAGES, CHECK_GROUPS.PROJECT_CLASSIFICATION],
    notChecked: NOT_CHECKED
  });
}));

test('returns an incomplete report for a missing repository path', () => {
  const missing = path.join(os.tmpdir(), `cloneproof-does-not-exist-${Date.now()}`);
  const report = scanRepository(missing);

  assert.equal(report.status, 'incomplete');
  assert.equal(finding(report, 'SCAN_ROOT_UNAVAILABLE').status, 'failed');
  assert.deepEqual(report.coverage.checked, []);
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
    maxTotalBytes: 10 * 1024 * 1024,
    maxLockfileBytes: 32 * 1024 * 1024,
    maxEntries: 200000
  });
}));

test('reports directories cut off by maxDepth in environment-check evidence', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'src/deep/config.js', 'process.env.DEEP_SETTING;\n');

  const report = scanRepository(root, { maxDepth: 1 });
  const skipped = finding(report, 'ENV_CHECK_SKIPPED');

  assert.equal(skipped.status, 'skipped');
  assert.ok(skipped.evidence.some((item) => item.path === 'src/deep'));
  assert.match(skipped.evidence.find((item) => item.path === 'src/deep').detail, /maximum scan depth/);
}));

test('classifies metadata failures as incomplete only for root core files', () => {
  assert.equal(classifyLstatFailure('package.json', { isFile: () => true }), 'error');
  assert.equal(classifyLstatFailure('README.md', { isFile: () => true }), 'error');
  assert.equal(classifyLstatFailure('src/index.js', { isFile: () => true }), 'skip');
  assert.equal(classifyLstatFailure('package.json', { isFile: () => false }), 'skip');
});

test('ignores oversized generated assets without making the scan incomplete', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'assets/generated.png', Buffer.alloc(1.1 * 1024 * 1024, 7));
  writeFile(root, 'assets/app.min.js', Buffer.alloc(2 * 1024 * 1024, 8));

  const report = scanRepository(root);

  assert.equal(report.status, 'passed');
  assert.equal(report.scan.complete, true);
  assert.equal(report.finding, undefined);
}));

test('skips an oversized ordinary source file without making the scan incomplete', () => withRepository((root) => {
  writeHealthyRepository(root);
  writeFile(root, 'src/large.js', `process.env.OVERSIZED_KEY = "${'x'.repeat(1.1 * 1024 * 1024)}";`);

  const report = scanRepository(root);

  assert.equal(report.scan.complete, true);
  assert.equal(report.status, 'passed');
  assert.equal(finding(report, 'ENV_CHECK_SKIPPED').status, 'skipped');
}));

test('allows a lockfile larger than the ordinary core file limit', () => withRepository((root) => {
  writeHealthyRepository(root);
  const lockfile = {
    name: 'fixture-project',
    lockfileVersion: 3,
    packages: {},
    padding: 'x'.repeat(2 * 1024 * 1024)
  };
  writeFile(root, 'package-lock.json', `${JSON.stringify(lockfile)}\n`);

  const report = scanRepository(root);

  assert.equal(report.scan.complete, true);
  assert.equal(report.status, 'passed');
  assert.equal(finding(report, 'LOCKFILE_INVALID'), undefined);
}));

test('exposes npm lockfile package counts for Docker network decisions', () => withRepository((root) => {
  writeFile(root, 'package.json', JSON.stringify({
    name: 'dependency-fixture',
    dependencies: { express: '^4.19.0' },
    scripts: { test: 'node --test' }
  }, null, 2));
  writeFile(root, 'package-lock.json', JSON.stringify({
    name: 'dependency-fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'dependency-fixture', dependencies: { express: '^4.19.0' } },
      'node_modules/express': { version: '4.19.0' },
      'node_modules/body-parser': { version: '1.20.2' }
    }
  }));

  const report = scanRepository(root);

  assert.deepEqual(report.project.lockfile, {
    path: 'package-lock.json',
    lockfileVersion: 3,
    externalPackageCount: 2
  });
}));

test('marks a traversal that exceeds maxEntries incomplete', () => withRepository((root) => {
  writeHealthyRepository(root);
  for (let index = 0; index < 8; index += 1) writeFile(root, `misc/file-${index}.txt`, 'x');

  const report = scanRepository(root, { maxEntries: 5 });

  assert.equal(report.status, 'incomplete');
  assert.equal(report.scan.complete, false);
}));
