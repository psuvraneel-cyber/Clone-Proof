'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_REPOSITORY_BYTES,
  buildGitCloneInvocation,
  cloneGithubRepository,
  isGithubRepositoryUrl,
  validateGithubUrl
} = require('../src/input/github');
const { resolveGitExecutable } = require('../src/util/executable');

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
      const destination = args.at(-1);
      fs.writeFileSync(path.join(destination, 'README.md'), '# fixture\n');
      fs.mkdirSync(path.join(destination, 'src'));
      fs.writeFileSync(path.join(destination, 'src', 'index.js'), 'module.exports = 1;\n');
      return successfulResult();
    }
  });

  assert.equal(calls.length, 2);
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

  assert.equal(result.root, calls[1].args.at(-1));
  assert.equal(result.path, result.root);
  assert.equal(result.metadata.complete, true);
  assert.equal(result.metadata.fileCount, 2);
  assert.equal(result.metadata.totalBytes, Buffer.byteLength('# fixture\n') + Buffer.byteLength('module.exports = 1;\n'));
  assert.equal(result.metadata.maxDepth, 1);
  assert.equal(result.preflight, 'checked');
  assert.equal(result.repositorySizeKb, 1);
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
  let destination;
  await assert.rejects(
    cloneGithubRepository(VALID_URL, {
      maxFiles: 1,
      gitExecutable: process.execPath,
      fetcher: publicFetcher(),
      runner: async (command, args) => {
        if (args[0] === '--version') return { ...successfulResult(), stdout: 'git version 2.47.0\n' };
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
  assert.equal(calls.length, 2);
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
        fs.writeFileSync(path.join(args.at(-1), 'README.md'), '# fixture\n');
        return successfulResult();
      }
    });

    assert.equal(result.preflight, 'unavailable');
    assert.equal(calls.length, 2);
    await result.cleanup();
  }
});
