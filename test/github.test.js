'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  cloneGithubRepository,
  isGithubRepositoryUrl,
  validateGithubUrl
} = require('../src/input/github');

const VALID_URL = 'https://github.com/example/project';

function successfulResult() {
  return {
    exitCode: 0,
    signal: null,
    stdout: 'Cloning into checkout...\n',
    stderr: '',
    timedOut: false,
    outputTruncated: false,
    error: null
  };
}

test('validates only exact public HTTPS GitHub repository URLs', () => {
  for (const value of [
    'http://github.com/example/project',
    'https://www.github.com/example/project',
    'https://gitlab.com/example/project',
    'https://github.com/example/project/issues',
    'https://github.com/example/project/tree/main',
    'https://github.com/example',
    'https://github.com/example/project/extra',
    'https://github.com/example/project?tab=readme',
    'https://github.com/example/project#readme',
    'https://user:password@github.com/example/project',
    'https://github.com.evil.example/example/project',
    'https://github.com/example/project/../other',
    'https://github.com/example/project%2Fother',
    'https://github.com/example/project.git/extra'
  ]) {
    assert.equal(isGithubRepositoryUrl(value), false, value);
    assert.throws(
      () => validateGithubUrl(value),
      (error) => error && error.code === 'GITHUB_URL_INVALID',
      value
    );
  }

  for (const [value, repo] of [
    [VALID_URL, 'example/project'],
    ['https://github.com/example/project/', 'example/project'],
    ['https://github.com/example/project.git', 'example/project'],
    ['https://github.com/example/project.git/', 'example/project']
  ]) {
    assert.deepEqual(validateGithubUrl(value), {
      url: value,
      owner: 'example',
      repo: 'project',
      repository: repo
    });
    assert.equal(isGithubRepositoryUrl(value), true);
  }
});

test('clones with safe git arguments and an injected no-network runner', async () => {
  const calls = [];
  const result = await cloneGithubRepository(VALID_URL, {
    timeoutMs: 4321,
    maxOutputBytes: 8192,
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      const destination = args.at(-1);
      fs.writeFileSync(path.join(destination, 'README.md'), '# fixture\n');
      fs.mkdirSync(path.join(destination, 'src'));
      fs.writeFileSync(path.join(destination, 'src', 'index.js'), 'module.exports = 1;\n');
      return successfulResult();
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args.slice(0, 4), ['clone', '--depth', '1', '--no-tags']);
  assert.equal(calls[0].args[4], VALID_URL);
  assert.equal(calls[0].args.length, 6);
  assert.equal(path.isAbsolute(calls[0].args[5]), true);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeoutMs, 4321);
  assert.equal(calls[0].options.maxOutputBytes, 8192);

  assert.equal(result.root, calls[0].args[5]);
  assert.equal(result.path, result.root);
  assert.equal(result.metadata.complete, true);
  assert.equal(result.metadata.fileCount, 2);
  assert.equal(result.metadata.totalBytes, Buffer.byteLength('# fixture\n') + Buffer.byteLength('module.exports = 1;\n'));
  assert.equal(result.metadata.maxDepth, 1);
  assert.equal(fs.existsSync(result.root), true);

  await result.cleanup();
  assert.equal(fs.existsSync(result.root), false);
  await result.cleanup();
});

test('cleans a temporary checkout when git fails', async () => {
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      runner: async (command, args) => {
        destination = args.at(-1);
        fs.writeFileSync(path.join(destination, 'partial.txt'), 'partial');
        return {
          ...successfulResult(),
          exitCode: 128,
          stderr: 'fatal: repository unavailable\n'
        };
      }
    }),
    (error) => error && error.code === 'GITHUB_CLONE_FAILED' && /repository unavailable/.test(error.message)
  );
  assert.ok(destination);
  assert.equal(fs.existsSync(destination), false);
});

test('cleans a temporary checkout when the injected runner throws', async () => {
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      runner: async (command, args) => {
        destination = args.at(-1);
        fs.writeFileSync(path.join(destination, 'partial.txt'), 'partial');
        throw new Error('runner failed');
      }
    }),
    /runner failed/
  );
  assert.ok(destination);
  assert.equal(fs.existsSync(destination), false);
});

test('rejects a checkout that exceeds a bound and removes it', async () => {
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      maxFiles: 1,
      runner: async (command, args) => {
        destination = args.at(-1);
        fs.writeFileSync(path.join(destination, 'one.txt'), '1');
        fs.writeFileSync(path.join(destination, 'two.txt'), '2');
        return successfulResult();
      }
    }),
    (error) => error && error.code === 'GITHUB_CHECKOUT_LIMIT_EXCEEDED'
  );
  assert.ok(destination);
  assert.equal(fs.existsSync(destination), false);
});
