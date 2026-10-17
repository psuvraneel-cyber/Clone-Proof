'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_OUTPUT_BYTES,
  MAX_REPOSITORY_BYTES,
  buildGitCloneInvocation,
  cloneGithubRepository,
  inspectCheckout,
  isGithubRepositoryUrl,
  parseGitExecutableModes,
  validateGithubUrl
} = require('../src/input/github');
const { resolveGitExecutable } = require('../src/util/executable');

const VALID_URL = 'https://github.com/example/project';
const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';

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

function commitResult() {
  return { ...successfulResult(), stdout: `${COMMIT_SHA}\n` };
}

function publicFetcher(size = 1) {
  return async () => ({
    status: 200,
    async json() {
      return { private: false, size };
    }
  });
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
    platform: 'linux',
    gitExecutable: process.execPath,
    fetcher: publicFetcher(),
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === '--version') {
        return { ...successfulResult(), stdout: 'git version 2.47.0.windows.1\n' };
      }
      if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
      if (args.includes('rev-parse')) return commitResult();
      const destination = args.at(-1);
      fs.writeFileSync(path.join(destination, 'README.md'), '# fixture\n');
      fs.mkdirSync(path.join(destination, 'src'));
      fs.writeFileSync(path.join(destination, 'src', 'index.js'), 'module.exports = 1;\n');
      return successfulResult();
    }
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[1].command, process.execPath);
  assert.deepEqual(calls[1].args.slice(-4), ['1', '--no-tags', VALID_URL, calls[1].args.at(-1)]);
  assert.deepEqual(calls[1].args.slice(0, -1), [
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'filter.lfs.smudge=',
    '-c', 'filter.lfs.process=',
    '-c', 'filter.lfs.required=false',
    'clone', '--depth', '1', '--no-tags', VALID_URL
  ]);
  assert.equal(calls[1].args.length, 20);
  assert.equal(path.isAbsolute(calls[1].args.at(-1)), true);
  assert.equal(path.basename(calls[1].args.at(-1)), 'checkout');
  assert.equal(calls[1].options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(calls[1].options.env.GIT_CONFIG_GLOBAL, path.join(path.dirname(calls[1].args.at(-1)), 'empty-gitconfig'));
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.timeoutMs, 4321);
  assert.equal(calls[1].options.maxOutputBytes, 8192);
  assert.equal(calls[2].args.includes('ls-files'), true);
  assert.equal(calls[3].args.includes('rev-parse'), true);

  assert.equal(result.root, calls[1].args.at(-1));
  assert.equal(result.path, result.root);
  assert.equal(result.metadata.complete, true);
  assert.equal(result.metadata.fileCount, 2);
  assert.equal(result.metadata.totalBytes, Buffer.byteLength('# fixture\n') + Buffer.byteLength('module.exports = 1;\n'));
  assert.equal(result.metadata.maxDepth, 1);
  assert.equal(result.preflight, 'checked');
  assert.equal(result.repositorySizeKb, 1);
  assert.equal(result.commit, COMMIT_SHA);
  assert.equal(fs.existsSync(result.root), true);

  await result.cleanup();
  assert.equal(fs.existsSync(result.root), false);
  await result.cleanup();
});

test('cleans a temporary checkout when git fails', async () => {
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      gitExecutable: process.execPath,
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
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
  assert.equal(fs.existsSync(path.dirname(destination)), false);
});

test('cleans a temporary checkout when the injected runner throws', async () => {
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      gitExecutable: process.execPath,
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
        destination = args.at(-1);
        fs.writeFileSync(path.join(destination, 'partial.txt'), 'partial');
        throw new Error('runner failed');
      }
    }),
    /runner failed/
  );
  assert.ok(destination);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(path.dirname(destination)), false);
});

test('rejects a checkout that exceeds a bound and removes it', async () => {
  const calls = [];
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      maxFiles: 1,
      gitExecutable: process.execPath,
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        calls.push(args);
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
        destination = args.at(-1);
        fs.writeFileSync(path.join(destination, 'one.txt'), '1');
        fs.writeFileSync(path.join(destination, 'two.txt'), '2');
        return successfulResult();
      }
    }),
    (error) => error && error.code === 'GITHUB_CHECKOUT_LIMIT_EXCEEDED'
  );
  assert.ok(destination);
  assert.equal(calls.some((args) => args.includes('ls-files')), false);
  assert.equal(fs.existsSync(destination), false);
});

test('checkout limits ignore the root .git directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-checkout-limits-'));
  try {
    fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'config'), 'metadata\n');
    fs.writeFileSync(path.join(root, '.git', 'objects', 'pack'), 'metadata\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');

    const metadata = inspectCheckout(root, { maxFiles: 1, maxEntries: 1 });

    assert.equal(metadata.fileCount, 1);
    assert.equal(metadata.entryCount, 1);
    assert.equal(metadata.complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('builds an isolated git environment and command line policy', () => {
  const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-git-invocation-'));
  try {
    const emptyConfig = path.join(parentPath, 'empty-gitconfig');
    fs.writeFileSync(emptyConfig, '');
    const previousSentinel = process.env.CLONEPROOF_TEST_SENTINEL;
    const previousAskPass = process.env.GIT_ASKPASS;
    process.env.CLONEPROOF_TEST_SENTINEL = 'secret';
    process.env.GIT_ASKPASS = 'host-helper';
    try {
      const invocation = buildGitCloneInvocation({
        url: VALID_URL,
        checkoutPath: path.join(parentPath, 'checkout'),
        parentPath,
        platform: 'linux'
      });

      assert.deepEqual(invocation.args, [
        '-c', 'credential.helper=',
        '-c', 'core.askPass=',
        '-c', 'protocol.allow=never',
        '-c', 'protocol.https.allow=always',
        '-c', 'filter.lfs.smudge=',
        '-c', 'filter.lfs.process=',
        '-c', 'filter.lfs.required=false',
        'clone', '--depth', '1', '--no-tags', VALID_URL, path.join(parentPath, 'checkout')
      ]);
      assert.equal(invocation.env.GIT_CONFIG_GLOBAL, emptyConfig);
      assert.equal(invocation.env.GIT_CONFIG_NOSYSTEM, '1');
      assert.equal(invocation.env.GIT_LFS_SKIP_SMUDGE, '1');
      assert.equal(invocation.env.CLONEPROOF_TEST_SENTINEL, undefined);
      assert.equal(invocation.env.GIT_ASKPASS, undefined);
      assert.equal(fs.existsSync(invocation.env.GIT_CONFIG_GLOBAL), true);
    } finally {
      if (previousSentinel === undefined) delete process.env.CLONEPROOF_TEST_SENTINEL;
      else process.env.CLONEPROOF_TEST_SENTINEL = previousSentinel;
      if (previousAskPass === undefined) delete process.env.GIT_ASKPASS;
      else process.env.GIT_ASKPASS = previousAskPass;
    }
  } finally {
    fs.rmSync(parentPath, { recursive: true, force: true });
  }
});

test('resolves git only from trusted absolute candidates', () => {
  const candidates = [];
  const resolved = resolveGitExecutable({
    platform: 'linux',
    env: { PATH: 'relative:/trusted/bin' },
    lookup: (candidate) => {
      candidates.push(candidate);
      return candidate === '/usr/local/bin/git' ? candidate : null;
    }
  });

  assert.equal(resolved, '/usr/local/bin/git');
  assert.deepEqual(candidates, ['/usr/bin/git', '/usr/local/bin/git']);
});

test('reports unavailable Git without creating a temporary clone folder', async () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cloneproof-github-')));
  let runnerCalled = false;

  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      executableLookup: () => null,
      fetcher: publicFetcher(),
      runner: async () => {
        runnerCalled = true;
        return successfulResult();
      }
    }),
    (error) => error && error.code === 'GITHUB_GIT_UNAVAILABLE'
  );

  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cloneproof-github-'));
  assert.equal(runnerCalled, false);
  assert.deepEqual(after.filter((name) => !before.has(name)), []);
});

test('preflights repository visibility and size before cloning', async () => {
  const fetchCalls = [];
  const calls = [];
  const result = await cloneGithubRepository(VALID_URL, {
    gitExecutable: process.execPath,
    fetcher: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        status: 200,
        async json() {
          return { private: false, size: 1234 };
        }
      };
    },
      runner: async (command, args) => {
        calls.push({ command, args });
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
        if (args.includes('rev-parse')) return commitResult();
        fs.writeFileSync(path.join(args.at(-1), 'README.md'), '# fixture\n');
      return successfulResult();
    }
  });

  assert.equal(result.preflight, 'checked');
  assert.equal(result.repositorySizeKb, 1234);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.github.com/repos/example/project');
  assert.deepEqual(fetchCalls[0].options.headers, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cloneproof'
  });
  assert.equal(fetchCalls[0].options.headers.Authorization, undefined);
  assert.equal(typeof fetchCalls[0].options.signal.aborted, 'boolean');
  assert.equal(calls.length, 4);
  await result.cleanup();
});

test('blocks private, missing, and oversized repositories before invoking git', async () => {
  const cases = [
    {
      response: { status: 404 },
      code: 'GITHUB_REPOSITORY_UNAVAILABLE'
    },
    {
      response: { status: 200, body: { private: true, size: 1 } },
      code: 'GITHUB_REPOSITORY_UNAVAILABLE'
    },
    {
      response: { status: 200, body: { private: false, size: Math.floor(MAX_REPOSITORY_BYTES / 1024) + 1 } },
      code: 'GITHUB_REPOSITORY_TOO_LARGE'
    }
  ];

  for (const item of cases) {
    let runnerCalls = 0;
    await assert.rejects(
      cloneGithubRepository(VALID_URL, {
        fetcher: async () => ({
          status: item.response.status,
          async json() {
            return item.response.body;
          }
        }),
        runner: async () => {
          runnerCalls += 1;
          return successfulResult();
        },
        gitExecutable: process.execPath
      }),
      (error) => error && error.code === item.code && error.preflight === 'checked'
    );
    assert.equal(runnerCalls, 0);
  }
});

test('continues cloning when the GitHub preflight is unavailable', async () => {
  for (const response of [
    { status: 403 },
    { status: 429 },
    { status: 500 },
    new Error('network unavailable')
  ]) {
    const calls = [];
    const result = await cloneGithubRepository(VALID_URL, {
      gitExecutable: process.execPath,
      fetcher: async () => {
        if (response instanceof Error) throw response;
        return { status: response.status };
      },
      runner: async (command, args) => {
        calls.push(args);
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
        if (args.includes('rev-parse')) return commitResult();
        fs.writeFileSync(path.join(args.at(-1), 'README.md'), '# fixture\n');
        return successfulResult();
      }
    });

    assert.equal(result.preflight, 'unavailable');
    assert.equal(calls.length, 4);
    await result.cleanup();
  }
});

test('records executable Git modes before removing clone metadata', async () => {
  const calls = [];
  const result = await cloneGithubRepository(VALID_URL, {
    gitExecutable: process.execPath,
    platform: 'linux',
    fetcher: publicFetcher(),
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
      if (args.includes('clone')) {
        const checkout = args.at(-1);
        fs.mkdirSync(path.join(checkout, '.git'));
        fs.mkdirSync(path.join(checkout, 'bin'));
        fs.writeFileSync(path.join(checkout, 'bin', 'run.js'), '#!/usr/bin/env node\n');
        fs.writeFileSync(path.join(checkout, 'README.md'), '# fixture\n');
        return successfulResult();
      }
      if (args.includes('ls-files')) {
        return {
          ...successfulResult(),
          stdout: [
            '100755 abc 0\tbin/run.js',
            '100644 def 0\tREADME.md'
          ].join('\0') + '\0'
        };
      }
      if (args.includes('rev-parse')) {
        const checkout = args[args.indexOf('-C') + 1];
        assert.equal(fs.existsSync(path.join(checkout, '.git')), true);
        return commitResult();
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    }
  });

  assert.deepEqual(result.executablePaths, ['bin/run.js']);
  assert.equal(result.executableModes, 'checked');
  assert.equal(result.commit, COMMIT_SHA);
  assert.equal(fs.existsSync(path.join(result.root, '.git')), false);
  assert.equal(calls.some((call) => call.args.includes('ls-files')), true);
  const modeCall = calls.find((call) => call.args.includes('ls-files'));
  assert.deepEqual(modeCall.args.slice(modeCall.args.indexOf('ls-files')), ['ls-files', '-s', '-z']);
  assert.equal(modeCall.options.maxOutputBytes, MAX_OUTPUT_BYTES);
  await result.cleanup();
});

test('NUL mode records preserve spaces and non-English paths and ignore non-executable modes', () => {
  const output = [
    '100644 aaa 0\treadme.md\0',
    '100755 bbb 0\tbin/run file.js\0',
    '100755 ccc 0\t日本語/実行.js\0',
    '100755 ddd 0\tquotes "stay".js\0'
  ].join('');

  assert.deepEqual(parseGitExecutableModes(output), [
    'bin/run file.js',
    'quotes "stay".js',
    '日本語/実行.js'
  ]);
});

test('ls-files failures, timeouts, and oversized output are non-fatal', async () => {
  const cases = [
    { exitCode: 1, stderr: 'fatal: index unavailable\n' },
    { exitCode: 0, timedOut: true },
    { exitCode: 0, outputTruncated: true },
    { throws: true }
  ];

  for (const modeFailure of cases) {
    let destination;
    const result = await cloneGithubRepository(VALID_URL, {
      gitExecutable: process.execPath,
      platform: 'linux',
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) {
          if (modeFailure.throws) throw new Error('mode lookup failed');
          return { ...successfulResult(), ...modeFailure, stdout: '' };
        }
        if (args.includes('rev-parse')) return commitResult();
        destination = args.at(-1);
        fs.mkdirSync(path.join(destination, '.git'));
        fs.writeFileSync(path.join(destination, 'README.md'), '# fixture\n');
        return successfulResult();
      }
    });

    assert.deepEqual(result.executablePaths, []);
    assert.equal(result.executableModes, 'unavailable');
    assert.equal(result.commit, COMMIT_SHA);
    assert.equal(result.metadata.complete, true);
    await result.cleanup();
  }
});

test('rev-parse failures and invalid output are non-fatal', async () => {
  const cases = [
    { exitCode: 128, stderr: 'fatal: not a repository\n' },
    { exitCode: 0, timedOut: true },
    { exitCode: 0, outputTruncated: true },
    { exitCode: 0, stdout: 'not-a-commit\n' }
  ];

  for (const commitFailure of cases) {
    const result = await cloneGithubRepository(VALID_URL, {
      gitExecutable: process.execPath,
      platform: 'linux',
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
        if (args.includes('ls-files')) return { ...successfulResult(), stdout: '' };
        if (args.includes('rev-parse')) return { ...successfulResult(), ...commitFailure };
        const destination = args.at(-1);
        fs.mkdirSync(path.join(destination, '.git'));
        fs.writeFileSync(path.join(destination, 'README.md'), '# fixture\n');
        return successfulResult();
      }
    });

    assert.equal(result.commit, undefined);
    assert.equal(result.executableModes, 'checked');
    await result.cleanup();
  }
});
