'use strict';

// Regressions for the false positives measured in field test Run 5
// (docs/FIELD_TEST.md): environment documentation and browser-test detection.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanRepository } = require('../src/scan/repository');
const { renderJson, renderText } = require('../src/report/render');

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-noise-'));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

function writePackage(root, packageData) {
  const data = { name: 'noise-fixture', scripts: { test: 'node --test' }, ...packageData };
  writeFile(root, 'package.json', JSON.stringify(data, null, 2));
  writeFile(root, 'package-lock.json', `${JSON.stringify({
    name: data.name,
    lockfileVersion: 3,
    packages: {
      '': {
        name: data.name,
        dependencies: data.dependencies,
        devDependencies: data.devDependencies
      }
    }
  }, null, 2)}\n`);
}

test('committed root .env files document keys without exposing their values', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/config.js', 'export const api = process.env.API_BASE_URI;\n');
  writeFile(root, '.env.development', 'API_BASE_URI=https://internal.example.invalid/very-secret-path\n');

  const report = scanRepository(root);
  const documented = finding(report, 'ENV_KEY_DOCUMENTED');

  assert.equal(finding(report, 'ENV_EXAMPLE_MISSING'), undefined);
  assert.equal(finding(report, 'ENV_KEY_MISSING'), undefined);
  assert.equal(documented.status, 'passed');
  assert.ok(documented.evidence.some((item) => item.path === '.env.development' && item.line === 1));
  for (const rendered of [renderJson(report), renderText(report)]) {
    assert.doesNotMatch(rendered, /very-secret-path/);
  }
}));

test('undocumented keys are still reported next to committed .env files', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/config.js', 'export const a = process.env.API_HOST;\nexport const b = process.env.PAYMENT_KEY;\n');
  writeFile(root, '.env', 'API_HOST=https://api.example.invalid\n');

  const report = scanRepository(root);
  const missing = report.findings.filter((item) => item.code === 'ENV_KEY_MISSING');

  assert.deepEqual(missing.map((item) => item.title), ['Environment key PAYMENT_KEY is missing from the example configuration']);
}));

test('a gitignored local .env does not count as documentation', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, '.gitignore', '.env\n');
  writeFile(root, '.env', 'API_HOST=https://api.example.invalid\n');
  writeFile(root, 'src/config.js', 'export const host = process.env.API_HOST;\n');

  const report = scanRepository(root);

  assert.match(finding(report, 'ENV_EXAMPLE_MISSING').message, /API_HOST/);
}));

test('Vite import.meta.env built-ins are not reported, but the same names on process.env are', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/env.ts', [
    'export const dev = import.meta.env.DEV;',
    'export const mode = import.meta.env.MODE;',
    'export const { BASE_URL, PROD, SSR } = import.meta.env;',
    'export const custom = process.env.DEV;'
  ].join('\n'));

  const report = scanRepository(root);
  const missing = finding(report, 'ENV_EXAMPLE_MISSING');

  assert.match(missing.message, /Source references DEV,/);
  assert.equal(missing.evidence.length, 1);
  assert.equal(missing.evidence[0].line, 4);
  assert.doesNotMatch(missing.message, /MODE|BASE_URL|PROD|SSR/);
}));

test('framework-provided keys are skipped only when the framework is a dependency', () => {
  const cases = [
    { dependency: 'wxt', source: 'export const ff = import.meta.env.FIREFOX;\n', key: 'FIREFOX' },
    { dependency: 'react-scripts', source: 'export const base = process.env.PUBLIC_URL;\n', key: 'PUBLIC_URL' },
    { dependency: 'next', source: 'export const runtime = process.env.NEXT_RUNTIME;\n', key: 'NEXT_RUNTIME' },
    { dependency: 'astro', source: 'export const site = import.meta.env.SITE;\n', key: 'SITE' }
  ];
  for (const { dependency, source, key } of cases) {
    withRepository((root) => {
      writePackage(root, { devDependencies: { [dependency]: '1.0.0' } });
      writeFile(root, 'src/index.js', source);
      assert.equal(finding(scanRepository(root), 'ENV_EXAMPLE_MISSING'), undefined, `${dependency} ${key}`);
    });
    withRepository((root) => {
      writePackage(root, {});
      writeFile(root, 'src/index.js', source);
      assert.match(finding(scanRepository(root), 'ENV_EXAMPLE_MISSING').message, new RegExp(key), `${key} without ${dependency}`);
    });
  }
});

test('keys injected by a build-time define map count as documented', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'tooling/webpack.config.ts', [
    'new DefinePlugin({',
    "  'process.env.APP_VERSION': JSON.stringify(version),",
    "  'import.meta.env.APP_CHANNEL': JSON.stringify('stable'),",
    '});'
  ].join('\n'));
  writeFile(root, 'src/about.ts', 'export const v = process.env.APP_VERSION;\nexport const c = import.meta.env.APP_CHANNEL;\n');

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENV_EXAMPLE_MISSING'), undefined);
  assert.equal(finding(report, 'ENV_KEY_MISSING'), undefined);
}));

function writeBrowserPackage(root, testScript, devDependencies = { playwright: '^1.50.0', vitest: '^3.0.0' }) {
  writePackage(root, { scripts: { test: testScript }, devDependencies });
}

test('Vitest in node or jsdom with Playwright installed is not a browser test workflow', () => withRepository((root) => {
  writeBrowserPackage(root, 'vitest run');
  writeFile(root, 'vitest.config.ts', "export default { test: { environment: 'jsdom' } };\n");

  assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED'), undefined);
}));

test('Vitest browser mode enabled in the root config is reported with config evidence', () => withRepository((root) => {
  writeBrowserPackage(root, 'vitest run');
  writeFile(root, 'vitest.config.ts', [
    'export default defineConfig({',
    '  test: {',
    '    browser: {',
    '      provider: playwright(),',
    '      enabled: true,',
    "      instances: [{ browser: 'chromium' }]",
    '    }',
    '  }',
    '});'
  ].join('\n'));

  const browser = finding(scanRepository(root), 'BROWSER_TESTS_DETECTED');

  assert.equal(browser.status, 'warning');
  assert.match(browser.message, /vitest \(browser mode\)/);
  assert.ok(browser.evidence.some((item) => item.path === 'vitest.config.ts' && item.line === 3));
}));

test('Vitest browser mode in an inline workspace project is reported', () => withRepository((root) => {
  writeBrowserPackage(root, 'tsc && vitest run');
  writeFile(root, 'vitest.workspace.ts', [
    'export default defineWorkspace([',
    "  { test: { environment: 'jsdom' } },",
    "  { test: { browser: { enabled: true, name: 'chromium', provider: 'playwright' } } }",
    ']);'
  ].join('\n'));

  assert.ok(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED'));
}));

test('a disabled browser block or an unselected browser project is not reported', () => {
  withRepository((root) => {
    writeBrowserPackage(root, 'vitest run');
    writeFile(root, 'vitest.config.ts', 'export default { test: { browser: { enabled: false, provider: "playwright" } } };\n');
    assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED'), undefined);
  });
  withRepository((root) => {
    writeBrowserPackage(root, 'vitest run --project unit');
    writeFile(root, 'vitest.config.ts', "export default { test: { projects: ['./vitest.browser.config.ts', './vitest.unit.config.ts'] } };\n");
    writeFile(root, 'vitest.browser.config.ts', "export default { test: { name: 'browser', browser: { enabled: true } } };\n");
    writeFile(root, 'vitest.unit.config.ts', "export default { test: { name: 'unit', environment: 'node' } };\n");
    assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED'), undefined);
  });
  withRepository((root) => {
    writeBrowserPackage(root, 'vitest run --project browser');
    writeFile(root, 'vitest.config.ts', "export default { test: { projects: ['./vitest.browser.config.ts'] } };\n");
    writeFile(root, 'vitest.browser.config.ts', "export default { test: { name: 'browser', browser: { enabled: true } } };\n");
    assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED').evidence.at(-1).path, 'vitest.browser.config.ts');
  });
});

test('an explicit --config file decides Vitest browser mode', () => withRepository((root) => {
  writeBrowserPackage(root, 'vitest run --config vitest.e2e.config.ts');
  writeFile(root, 'vitest.config.ts', "export default { test: { environment: 'node' } };\n");
  writeFile(root, 'vitest.e2e.config.ts', 'export default { test: { browser: { enabled: true } } };\n');

  assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED').evidence.at(-1).path, 'vitest.e2e.config.ts');
}));

test('dedicated browser runners in the test workflow are still reported', () => withRepository((root) => {
  writeBrowserPackage(root, 'npm run test:unit && npm run test:e2e', { '@playwright/test': '^1.50.0' });
  const data = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  data.scripts['test:unit'] = 'node --test';
  data.scripts['test:e2e'] = 'playwright test';
  writeFile(root, 'package.json', JSON.stringify(data, null, 2));

  assert.match(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED').message, /runs playwright/);
}));

test('flags of other commands in the test script do not filter Vitest projects', () => withRepository((root) => {
  writeBrowserPackage(root, 'tsc --project tsconfig.test.json -c other.json && vitest run');
  writeFile(root, 'vitest.workspace.ts', "export default defineWorkspace([{ test: { browser: { enabled: true, provider: 'playwright' } } }]);\n");

  assert.equal(finding(scanRepository(root), 'BROWSER_TESTS_DETECTED').evidence.at(-1).path, 'vitest.workspace.ts');
}));

// Field test Run 6: environment keys nobody configures, comments, type
// declarations, non-JavaScript test suites, npm range spacing, and public
// registry mirrors.

test('keys set by the OS, shell, Git, CI, or the tool itself are not undocumented settings', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/system.js', [
    'const home = process.env.HOMEPATH || process.env.homepath;',
    'const programs = process.env.PROGRAMFILES;',
    'const previous = process.env.OLDPWD;',
    'const scratch = process.env.Wimp$ScrapDir;',
    'const completing = process.env.COMP_CWORD;',
    'const gitDir = process.env.GIT_DIR;',
    'const onTravis = process.env.TRAVIS;',
    'const pages = process.env.CF_PAGES_BRANCH;',
    'if (!process.env.WEBPACK_SERVE) process.env.WEBPACK_SERVE = "true";',
    'process.env["TOOL_CHILD"] = "1";',
    'const child = process.env.TOOL_CHILD;'
  ].join('\n'));

  const report = scanRepository(root);

  assert.equal(finding(report, 'ENV_EXAMPLE_MISSING'), undefined);
  assert.equal(finding(report, 'ENV_KEY_MISSING'), undefined);
}));

test('environment keys with $ are read whole, and comments and .d.ts files are ignored', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/config.js', [
    '// Set process.env.COMMENTED_LINE to change nothing.',
    '/* process.env.COMMENTED_BLOCK */',
    'const url = "http://example.invalid/" + process.env.API_TOKEN$V2;',
    'const pattern = /\\/\\//; const after = process.env.AFTER_REGEX;'
  ].join('\n'));
  writeFile(root, 'src/types.d.ts', '/** Reads `process.env.TYPED_ONLY`. */\nexport declare const x: string;\n');

  const report = scanRepository(root);
  const missing = finding(report, 'ENV_EXAMPLE_MISSING');

  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /API_TOKEN\$V2, AFTER_REGEX|AFTER_REGEX, API_TOKEN\$V2/);
  assert.doesNotMatch(missing.message, /COMMENTED_LINE|COMMENTED_BLOCK|TYPED_ONLY|\bAPI_TOKEN\b(?!\$)/);
}));

test('ROLLUP_WATCH is set by Rollup only when Rollup is a dependency', () => {
  for (const [devDependencies, expected] of [[{ rollup: '^4.0.0' }, false], [{}, true]]) {
    withRepository((root) => {
      writePackage(root, { devDependencies });
      writeFile(root, 'src/index.js', 'export const watch = process.env.ROLLUP_WATCH === "true";\n');
      assert.equal(Boolean(finding(scanRepository(root), 'ENV_EXAMPLE_MISSING')), expected, JSON.stringify(devDependencies));
    });
  }
});

test('shell and other-language test suites are tests, so a missing test script still fails', () => {
  for (const [file, contents] of [
    ['test/1_default.sh', '#!/bin/sh\n'],
    ['test.sh', '#!/bin/sh\n'],
    ['test/sass_test.dart', 'void main() {}\n'],
    ['tests/test_tool.py', 'def test_x(): pass\n']
  ]) {
    withRepository((root) => {
      writePackage(root, { scripts: {} });
      writeFile(root, 'index.js', 'module.exports = 1;\n');
      writeFile(root, file, contents);
      const report = scanRepository(root);
      assert.equal(finding(report, 'NO_TESTS_FOUND'), undefined, file);
      assert.equal(finding(report, 'TEST_SCRIPT_MISSING').status, 'failed', file);
    });
  }
});

test('a shell script that is not under test/ does not count as a test suite', () => withRepository((root) => {
  writePackage(root, { scripts: {} });
  writeFile(root, 'index.js', 'module.exports = 1;\n');
  writeFile(root, 'scripts/release.sh', '#!/bin/sh\n');

  assert.equal(finding(scanRepository(root), 'NO_TESTS_FOUND').status, 'warning');
}));

test('engines.node ranges with a space after the operator are understood', () => {
  for (const [nvmrc, engines, expected] of [
    ['24', '^22.14.0 || >= 24.10.0', undefined],
    ['24.11.0', '>= 24.10.0', undefined],
    ['24.9.0', '>= 24.10.0', 'warning']
  ]) {
    withRepository((root) => {
      writePackage(root, { engines: { node: engines } });
      writeFile(root, '.nvmrc', `${nvmrc}\n`);
      const unsatisfied = finding(scanRepository(root), 'ENGINES_NODE_UNSATISFIED');
      assert.equal(unsatisfied && unsatisfied.status, expected, `${nvmrc} vs ${engines}`);
    });
  }
});

test('public npm mirrors are not reported as private registries', () => {
  for (const [registry, expected] of [
    ['https://registry.npmmirror.com/', undefined],
    ['https://npm.internal.example.invalid/', 'warning']
  ]) {
    withRepository((root) => {
      writePackage(root, {});
      writeFile(root, '.npmrc', `registry=${registry}\n`);
      const privateRegistry = finding(scanRepository(root), 'PRIVATE_REGISTRY');
      assert.equal(privateRegistry && privateRegistry.status, expected, registry);
    });
  }
});

test('keys assigned only in tests still need documentation', () => withRepository((root) => {
  writePackage(root, {});
  writeFile(root, 'src/db.js', 'export const url = process.env.DATABASE_URL;\n');
  writeFile(root, 'test/setup.js', 'process.env.DATABASE_URL = "postgres://localhost/test";\n');

  const missing = finding(scanRepository(root), 'ENV_EXAMPLE_MISSING');

  assert.equal(missing.status, 'warning');
  assert.match(missing.message, /DATABASE_URL/);
}));
