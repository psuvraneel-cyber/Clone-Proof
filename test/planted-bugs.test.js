'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanRepository } = require('../src/scan/repository');

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeHealthyBase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-planted-base-'));
  writeJson(root, 'package.json', {
    name: 'planted-bug-fixture',
    packageManager: 'npm@10.8.2',
    engines: { node: '>=22.0.0' },
    dependencies: { 'example-package': '^1.0.0' },
    scripts: {
      build: 'node build.js',
      test: 'node --test'
    }
  });
  writeJson(root, 'package-lock.json', {
    name: 'planted-bug-fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'planted-bug-fixture',
        dependencies: { 'example-package': '^1.0.0' }
      },
      'node_modules/example-package': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/example-package/-/example-package-1.0.0.tgz'
      }
    }
  });
  writeFile(root, 'README.md', '# Planted bug fixture\n\n```sh\nnpm ci\nnpm test\nnpm run build\n```\n');
  writeFile(root, '.env.example', 'DOCUMENTED_KEY=placeholder\n');
  writeFile(root, '.nvmrc', '22.19.0\n');
  writeFile(root, 'Dockerfile', 'FROM node:22.19.0-bookworm-slim\n');
  writeFile(root, 'src/index.js', 'module.exports = process.env.DOCUMENTED_KEY;\n');
  writeFile(root, 'test/index.test.js', 'test("fixture", () => {});\n');
  return root;
}

function finding(report, code) {
  return report.findings.find((item) => item.code === code);
}

function findingSignature(report) {
  return report.findings.map((item) => `${item.code}:${item.status}:${item.severity}`);
}

function copyBase(base) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-planted-case-'));
  fs.cpSync(base, copy, { recursive: true });
  return copy;
}

function withBase(callback) {
  const base = makeHealthyBase();
  try {
    return callback(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function withCase(base, callback) {
  const copy = copyBase(base);
  try {
    return callback(copy);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

test('the realistic planted-bug base project passes static inspection', () => withBase((base) => {
  const report = scanRepository(base);

  assert.equal(report.status, 'passed');
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
}));

test('offline planted-bug mutations produce the expected findings', () => withBase((base) => {
  const cases = [
    {
      number: 1,
      name: 'removing a dependency from the lockfile',
      expectedStatus: 'failed',
      expectedCodes: ['LOCKFILE_OUT_OF_SYNC'],
      apply(root) {
        const lockfile = readJson(root, 'package-lock.json');
        delete lockfile.packages[''].dependencies['example-package'];
        writeJson(root, 'package-lock.json', lockfile);
      }
    },
    {
      number: 2,
      name: 'deleting scripts.test',
      expectedStatus: 'failed',
      expectedCodes: ['TEST_SCRIPT_MISSING'],
      apply(root) {
        const packageData = readJson(root, 'package.json');
        delete packageData.scripts.test;
        writeJson(root, 'package.json', packageData);
      }
    },
    {
      number: 3,
      name: 'using the npm placeholder test script',
      expectedStatus: 'failed',
      expectedCodes: ['TEST_SCRIPT_PLACEHOLDER'],
      apply(root) {
        const packageData = readJson(root, 'package.json');
        packageData.scripts.test = 'echo "Error: no test specified" && exit 1';
        writeJson(root, 'package.json', packageData);
      }
    },
    {
      number: 4,
      name: 'renaming the build script',
      expectedStatus: 'failed',
      expectedCodes: ['README_SCRIPT_UNKNOWN'],
      apply(root) {
        const packageData = readJson(root, 'package.json');
        packageData.scripts.compile = packageData.scripts.build;
        delete packageData.scripts.build;
        writeJson(root, 'package.json', packageData);
      }
    },
    {
      number: 5,
      name: 'adding an undocumented application environment key',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['ENV_KEY_MISSING'],
      apply(root) {
        writeFile(root, 'src/payment.js', 'module.exports = process.env.PAYMENT_API_KEY;\n');
      }
    },
    {
      number: 6,
      name: 'pinning a Node major outside engines.node',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['ENGINES_NODE_UNSATISFIED', 'RUNTIME_VERSION_MISMATCH'],
      apply(root) {
        writeFile(root, '.nvmrc', '20\n');
      }
    },
    {
      number: 7,
      name: 'ignoring the package lockfile',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['CORE_FILE_GITIGNORED'],
      apply(root) {
        writeFile(root, '.gitignore', 'package-lock.json\n');
      }
    },
    {
      number: 8,
      name: 'deleting the package lockfile',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['LOCKFILE_MISSING'],
      apply(root) {
        fs.rmSync(path.join(root, 'package-lock.json'));
      }
    },
    {
      number: 9,
      name: 'corrupting package.json',
      expectedStatus: 'failed',
      expectedCodes: ['PACKAGE_JSON_INVALID'],
      apply(root) {
        writeFile(root, 'package.json', '{"name":\n');
      }
    },
    {
      number: 10,
      name: 'adding a private registry',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['PRIVATE_REGISTRY'],
      apply(root) {
        writeFile(root, '.npmrc', 'registry=https://npm.internal.example/\n//npm.internal.example/:_authToken=SECRET123\n');
      }
    },
    {
      number: 11,
      name: 'documenting the wrong setup package manager',
      expectedStatus: 'passed_with_warnings',
      expectedCodes: ['README_PACKAGE_MANAGER_MISMATCH'],
      apply(root) {
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        writeFile(root, 'README.md', readme.replace('npm ci', 'yarn install'));
      }
    },
    {
      number: 12,
      name: 'declaring pnpm next to an npm lockfile',
      expectedStatus: 'failed',
      expectedCodes: ['PACKAGE_MANAGER_LOCKFILE_MISMATCH'],
      apply(root) {
        const packageData = readJson(root, 'package.json');
        packageData.packageManager = 'pnpm@9.0.0';
        writeJson(root, 'package.json', packageData);
      }
    },
    {
      number: 13,
      name: 'editing README whitespace only',
      expectedStatus: 'passed',
      expectedCodes: [],
      apply(root) {
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        writeFile(root, 'README.md', `${readme}\n`);
      },
      compareWithBase: true
    }
  ];

  const baseReport = scanRepository(base);
  for (const planted of cases) {
    withCase(base, (root) => {
      planted.apply(root);
      const report = scanRepository(root);

      assert.equal(report.status, planted.expectedStatus, `bug ${planted.number}: ${planted.name}`);
      for (const code of planted.expectedCodes) {
        assert.ok(finding(report, code), `bug ${planted.number}: expected ${code}`);
      }
      if (planted.number === 6) {
        assert.ok(
          finding(report, 'ENGINES_NODE_UNSATISFIED') || finding(report, 'RUNTIME_VERSION_MISMATCH'),
          'bug 6: expected a runtime warning'
        );
      }
      if (planted.number === 10) {
        const rendered = JSON.stringify(report);
        assert.doesNotMatch(rendered, /SECRET123/);
        assert.match(rendered, /npm\.internal\.example/);
      }
      if (planted.compareWithBase) {
        assert.deepEqual(findingSignature(report), findingSignature(baseReport));
      }
    });
  }
}));
