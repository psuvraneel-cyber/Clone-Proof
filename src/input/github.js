'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { resolveGitExecutable } = require('../util/executable');
const { runCleanupSupervisor, startCleanupSupervisor, stopCleanupSupervisor } = require('../util/cleanup-supervisor');
const { sanitizeText } = require('../util/sanitize-paths');

const DEFAULT_CLONE_LIMITS = Object.freeze({
  maxDepth: 25,
  maxFiles: 10000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntries: 200000
});
const DEFAULT_CLONE_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_REPOSITORY_BYTES = 4 * 1024 * 1024 * 1024;
const GITHUB_PREFLIGHT_TIMEOUT_MS = 10 * 1000;

function copyEnvironmentValue(environment, hostEnvironment, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(hostEnvironment, name) && hostEnvironment[name] !== undefined) {
      environment[name] = String(hostEnvironment[name]);
    }
  }
}

/**
 * Build the complete, allow-listed git invocation for a public clone.
 *
 * The caller owns parentPath and creates empty-gitconfig before starting git.
 * hostEnvironment is injectable for deterministic tests; no other host
 * environment variables are copied into the returned environment.
 */
function buildGitCloneInvocation({
  url,
  checkoutPath,
  parentPath,
  platform = process.platform,
  hostEnvironment = process.env,
  useGlobalConfig = true
}) {
  const environment = {};
  copyEnvironmentValue(environment, hostEnvironment, ['PATH', 'Path']);
  if (platform === 'win32') {
    copyEnvironmentValue(environment, hostEnvironment, ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']);
  }
  for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
    copyEnvironmentValue(environment, hostEnvironment, [name]);
  }

  environment.HOME = parentPath;
  environment.XDG_CONFIG_HOME = parentPath;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  if (useGlobalConfig) {
    environment.GIT_CONFIG_GLOBAL = path.join(parentPath, 'empty-gitconfig');
  }
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GCM_INTERACTIVE = 'never';
  environment.GIT_LFS_SKIP_SMUDGE = '1';

  const configArgs = [
    ['credential.helper', ''],
    ['core.askPass', ''],
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['filter.lfs.smudge', ''],
    ['filter.lfs.process', ''],
    ['filter.lfs.required', 'false']
  ];
  if (platform === 'win32') configArgs.push(['core.longpaths', 'true']);

  return {
    args: [
      ...configArgs.flatMap(([key, value]) => ['-c', `${key}=${value}`]),
      'clone',
      '--depth',
      '1',
      '--no-tags',
      url,
      checkoutPath
    ],
    env: environment
  };
}

class GithubSourceError extends Error {
  constructor(message, code = 'GITHUB_SOURCE_ERROR') {
    super(message);
    this.name = 'GithubSourceError';
    this.code = code;
  }
}

function normalizePositiveInteger(value, fallback, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), maximum);
}

function normalizeLimit(value, fallback, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), maximum);
}

function normalizeCloneLimits(options = {}) {
  const nested = options.limits && typeof options.limits === 'object'
    ? options.limits
    : {};
  const valueFor = (name) => options[name] === undefined ? nested[name] : options[name];

  return {
    maxDepth: normalizeLimit(valueFor('maxDepth'), DEFAULT_CLONE_LIMITS.maxDepth, 100),
    maxFiles: normalizeLimit(valueFor('maxFiles'), DEFAULT_CLONE_LIMITS.maxFiles, DEFAULT_CLONE_LIMITS.maxFiles),
    maxFileBytes: normalizeLimit(
      valueFor('maxFileBytes'),
      DEFAULT_CLONE_LIMITS.maxFileBytes,
      DEFAULT_CLONE_LIMITS.maxFileBytes
    ),
    maxTotalBytes: normalizeLimit(
      valueFor('maxTotalBytes'),
      DEFAULT_CLONE_LIMITS.maxTotalBytes,
      DEFAULT_CLONE_LIMITS.maxTotalBytes
    ),
    maxEntries: normalizeLimit(valueFor('maxEntries'), DEFAULT_CLONE_LIMITS.maxEntries, DEFAULT_CLONE_LIMITS.maxEntries)
  };
}

function invalidUrl(message) {
  throw new GithubSourceError(`Invalid GitHub repository URL: ${message}`, 'GITHUB_URL_INVALID');
}

function canonicalGithubRepositoryUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

/**
 * Validate and describe a public GitHub repository URL.
 *
 * The returned URL is safe to pass as one argument to git. It is deliberately
 * limited to the public HTTPS GitHub origin and a single owner/repository
 * path, so it cannot select a subdirectory, pull request, archive, or remote
 * host.
 */
function validateGithubUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    invalidUrl('expected a non-empty string');
  }
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    invalidUrl('whitespace or control characters are not allowed');
  }
  // WHATWG URL parsing normalizes dot segments and backslashes. Reject them
  // before parsing so an input such as /owner/repo/../other cannot become a
  // different, apparently valid two-component path.
  if (value.includes('\\') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) {
    invalidUrl('path traversal is not allowed');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalidUrl('URL syntax is not valid');
  }

  if (parsed.protocol !== 'https:') {
    invalidUrl('only HTTPS URLs are supported');
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    invalidUrl('the host must be github.com or www.github.com');
  }
  if (parsed.port !== '') {
    invalidUrl('custom ports are not supported');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    invalidUrl('credentials are not allowed');
  }
  // GitHub names do not need URL decoding here. Rejecting escapes also
  // prevents encoded slashes and other alternate path spellings from
  // bypassing the exact two-component check.
  const pathMatch = /^\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(parsed.pathname);
  if (!pathMatch) {
    const subpathMatch = /^\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/(tree|blob)(?:\/|$)/i.exec(parsed.pathname);
    if (subpathMatch) {
      invalidUrl(
        `GitHub ${subpathMatch[3].toLowerCase()} URLs are not supported; use the canonical repository URL ${canonicalGithubRepositoryUrl(subpathMatch[1], subpathMatch[2])}`
      );
    }
    invalidUrl('expected exactly /owner/repository with an optional .git suffix or trailing slash');
  }

  const owner = pathMatch[1];
  const repo = pathMatch[2];
  return Object.freeze({
    url: canonicalGithubRepositoryUrl(owner, repo),
    owner,
    repo,
    repository: `${owner}/${repo}`
  });
}

function isGithubRepositoryUrl(value) {
  try {
    validateGithubUrl(value);
    return true;
  } catch {
    return false;
  }
}

function githubTokenFromEnvironment(environment = process.env) {
  const preferred = environment.CLONEPROOF_GITHUB_TOKEN;
  const fallback = environment.GITHUB_TOKEN;
  const value = preferred === undefined || preferred === null || String(preferred).length === 0
    ? fallback
    : preferred;
  if (value === undefined || value === null || String(value).length === 0) return null;
  return String(value);
}

function redactGithubToken(value, token) {
  const text = value === undefined || value === null ? '' : String(value);
  if (!token) return text;
  return text.split(token).join('[REDACTED]');
}

async function preflightGithubRepository(source, fetcher = globalThis.fetch, options = {}) {
  const hostEnvironment = options && (options.hostEnvironment || options.environment)
    ? (options.hostEnvironment || options.environment)
    : process.env;
  const token = githubTokenFromEnvironment(hostEnvironment);
  let preflightAuthenticated = token !== null;
  let preflightTokenRejected = false;
  const tokenRejectionMetadata = () => preflightTokenRejected
    ? { preflightTokenRejected: true }
    : {};
  const unavailable = (preflightReason, error) => ({
    state: 'unavailable',
    preflightAuthenticated,
    preflightReason,
    ...tokenRejectionMetadata(),
    ...(error ? { error: redactGithubToken(error, token) } : {})
  });

  if (typeof fetcher !== 'function') return unavailable('no-fetch');

  const apiUrl = `https://api.github.com/repos/${source.owner}/${source.repo}`;
  const fetchMetadata = (requestToken) => {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cloneproof'
    };
    if (requestToken !== null) headers.Authorization = `Bearer ${requestToken}`;
    return fetcher(apiUrl, {
      headers,
      signal: AbortSignal.timeout(GITHUB_PREFLIGHT_TIMEOUT_MS)
    });
  };
  try {
    let response = await fetchMetadata(token);
    if (response && response.status === 401 && token !== null) {
      preflightTokenRejected = true;
      preflightAuthenticated = false;
      response = await fetchMetadata(null);
    }
    if (!response || typeof response.status !== 'number') return unavailable('invalid-response');
    if (response.status === 401) return unavailable('http-401');
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('x-ratelimit-remaining')
        : null;
      return unavailable(
        response.status === 403 && String(remaining) === '0' ? 'rate-limited' : `http-${response.status}`
      );
    }
    if (response.status === 404) {
      const error = new GithubSourceError(
        'GitHub repository is not found or not public.',
        'GITHUB_REPOSITORY_UNAVAILABLE'
      );
      error.preflight = 'checked';
      error.preflightAuthenticated = preflightAuthenticated;
      error.preflightReason = 'http-404';
      Object.assign(error, tokenRejectionMetadata());
      throw error;
    }
    if (response.status !== 200) return unavailable(`http-${response.status}`);

    let metadata;
    try {
      metadata = await response.json();
    } catch (error) {
      return unavailable('invalid-response', error && error.message ? error.message : error);
    }
    if (!metadata || metadata.private === true) {
      const error = new GithubSourceError(
        'GitHub repository is not found or not public.',
        'GITHUB_REPOSITORY_UNAVAILABLE'
      );
      error.preflight = 'checked';
      error.preflightAuthenticated = preflightAuthenticated;
      error.preflightReason = 'checked';
      Object.assign(error, tokenRejectionMetadata());
      throw error;
    }
    if (metadata.private !== false || !Number.isFinite(metadata.size) || metadata.size < 0) {
      return unavailable('invalid-response');
    }

    const repositorySizeKb = metadata.size;
    if (repositorySizeKb * 1024 > MAX_REPOSITORY_BYTES) {
      const error = new GithubSourceError(
        `GitHub reports ${repositorySizeKb} KiB for the repository's full history, exceeding the 4 GiB sanity limit.`,
        'GITHUB_REPOSITORY_TOO_LARGE'
      );
      error.preflight = 'checked';
      error.preflightAuthenticated = preflightAuthenticated;
      error.preflightReason = 'checked';
      Object.assign(error, tokenRejectionMetadata());
      error.repositorySizeKb = repositorySizeKb;
      throw error;
    }

    return {
      state: 'checked',
      preflightReason: 'checked',
      repositorySizeKb,
      preflightAuthenticated,
      ...tokenRejectionMetadata()
    };
  } catch (error) {
    if (error && (error.code === 'GITHUB_REPOSITORY_UNAVAILABLE' || error.code === 'GITHUB_REPOSITORY_TOO_LARGE')) {
      throw error;
    }
    return unavailable(
      error && error.name === 'AbortError' ? 'timeout' : 'network-error',
      error && error.message ? error.message : error
    );
  }
}

function relativePath(rootPath, absolutePath) {
  return (path.relative(rootPath, absolutePath) || '.').split(path.sep).join('/');
}

function limitError(label, relative, limitName, limit, count) {
  const error = new GithubSourceError(
    `GitHub checkout limit exceeded: ${label} exceeded configured ${limitName}=${limit}; count reached ${count}${relative ? ` at ${relative}` : ''}`,
    'GITHUB_CHECKOUT_LIMIT_EXCEEDED'
  );
  error.limit = limit;
  error.limitName = limitName;
  error.count = count;
  error.path = relative || '.';
  return error;
}

/**
 * Inspect a checkout without following symlinks.
 *
 * This is synchronous on purpose: cloneGithubRepository performs it before
 * handing the path to a caller, and a synchronous walk keeps the limit checks
 * atomic with respect to this process's view of the checkout.
 */
function inspectCheckout(rootPath, options = {}) {
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new TypeError('checkout root must be a non-empty path');
  }

  const limits = normalizeCloneLimits(options);
  const root = path.resolve(rootPath);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    throw new GithubSourceError(`GitHub checkout is unavailable: ${error.message}`, 'GITHUB_CHECKOUT_UNAVAILABLE');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new GithubSourceError('GitHub checkout root is not a directory', 'GITHUB_CHECKOUT_UNAVAILABLE');
  }

  const metadata = {
    complete: true,
    fileCount: 0,
    totalBytes: 0,
    maxDepth: 0,
    entryCount: 0,
    symlinkCount: 0,
    symlinkPaths: [],
    limits
  };

  function walk(directory, depth) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
      entries = [
        ...entries.filter((entry) => !entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name)),
        ...entries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))
      ];
    } catch (error) {
      throw new GithubSourceError(
        `Unable to inspect GitHub checkout at ${relativePath(root, directory)}: ${error.message}`,
        'GITHUB_CHECKOUT_UNAVAILABLE'
      );
    }

    for (const entry of entries) {
      if (depth === 0 && entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativePath(root, absolute);
      metadata.entryCount += 1;
      if (metadata.entryCount > limits.maxEntries) {
        throw limitError('entry count', relative, 'maxEntries', limits.maxEntries, metadata.entryCount);
      }

      let stat;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        throw new GithubSourceError(
          `Unable to inspect GitHub checkout entry ${relative}: ${error.message}`,
          'GITHUB_CHECKOUT_UNAVAILABLE'
        );
      }

      if (stat.isSymbolicLink()) {
        metadata.symlinkCount += 1;
        metadata.symlinkPaths.push(relative);
        metadata.maxDepth = Math.max(metadata.maxDepth, depth);
        continue;
      }

      if (stat.isDirectory()) {
        const nextDepth = depth + 1;
        if (nextDepth > limits.maxDepth) {
          throw limitError('directory depth', relative, 'maxDepth', limits.maxDepth, nextDepth);
        }
        metadata.maxDepth = Math.max(metadata.maxDepth, nextDepth);
        walk(absolute, nextDepth);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > limits.maxFileBytes) {
        throw limitError('file size', relative, 'maxFileBytes', limits.maxFileBytes, stat.size);
      }
      if (metadata.fileCount >= limits.maxFiles) {
        throw limitError('file count', relative, 'maxFiles', limits.maxFiles, metadata.fileCount + 1);
      }
      if (metadata.totalBytes + stat.size > limits.maxTotalBytes) {
        throw limitError(
          'total file bytes',
          relative,
          'maxTotalBytes',
          limits.maxTotalBytes,
          metadata.totalBytes + stat.size
        );
      }

      metadata.fileCount += 1;
      metadata.totalBytes += stat.size;
      metadata.maxDepth = Math.max(metadata.maxDepth, depth);
    }
  }

  walk(root, 0);
  return metadata;
}

function appendOutput(state, channel, chunk, child) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
  const remaining = state.maxBytes - state.bytes;
  if (remaining <= 0) {
    state.truncated = true;
  } else if (bytes.length <= remaining) {
    state.parts[channel].push(bytes);
    state.bytes += bytes.length;
  } else {
    state.parts[channel].push(bytes.subarray(0, remaining));
    state.bytes = state.maxBytes;
    state.truncated = true;
  }

  if (state.truncated && !state.killedForOutput) {
    state.killedForOutput = true;
    try {
      child.kill('SIGKILL');
    } catch {
      // The close/error event still completes the bounded runner if the
      // process has already exited.
    }
  }
}

/**
 * Run git without a shell and with bounded output and wall-clock time.
 * Exporting cloneGithubRepository's runner seam keeps tests network-free.
 */
function runProcess(command, args, options = {}) {
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_CLONE_TIMEOUT_MS, MAX_CLONE_TIMEOUT_MS);
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: options.processGroup === true && process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        outputTruncated: false,
        error: error.message
      });
      return;
    }

    const childPid = child.pid || null;
    if (options.pidFile && childPid) {
      try {
        fs.writeFileSync(options.pidFile, String(childPid), 'utf8');
      } catch {
        // Cleanup remains best-effort if the PID file cannot be written.
      }
    }

    const output = {
      maxBytes: maxOutputBytes,
      bytes: 0,
      parts: { stdout: [], stderr: [] },
      truncated: false,
      killedForOutput: false
    };
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // The close/error event will settle the promise.
      }
    }, timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.pidFile && childPid) {
        try {
          if (fs.readFileSync(options.pidFile, 'utf8').trim() === String(childPid)) {
            fs.rmSync(options.pidFile, { force: true });
          }
        } catch {
          // The cleanup supervisor owns the file if the parent exits abruptly.
        }
      }
      resolve({
        command,
        args,
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
        stdout: Buffer.concat(output.parts.stdout).toString('utf8'),
        stderr: Buffer.concat(output.parts.stderr).toString('utf8'),
        timedOut,
        outputTruncated: output.truncated,
        pid: childPid,
        error: result.error || null
      });
    };

    child.stdout.on('data', (chunk) => appendOutput(output, 'stdout', chunk, child));
    child.stderr.on('data', (chunk) => appendOutput(output, 'stderr', chunk, child));
    child.once('error', (error) => finish({ error: error.message }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal }));
  });
}

function resultExitCode(result) {
  if (!result || typeof result !== 'object') return null;
  if (typeof result.exitCode === 'number' || result.exitCode === null) return result.exitCode;
  if (typeof result.code === 'number' || result.code === null) return result.code;
  if (typeof result.status === 'number' || result.status === null) return result.status;
  return null;
}

function outputString(value, maxBytes) {
  if (value === undefined || value === null) return '';
  const bytes = Buffer.from(String(value), 'utf8');
  return bytes.subarray(0, maxBytes).toString('utf8');
}

function cloneFailure(result, maxOutputBytes, token, temporaryPaths = []) {
  const exitCode = resultExitCode(result);
  const reason = result && result.timedOut
    ? 'timed out'
    : result && result.outputTruncated
      ? 'produced too much output'
      : result && result.error
        ? redactGithubToken(result.error, token)
        : `exited with code ${exitCode === null ? 'unknown' : exitCode}`;
  const stderr = outputString(result && result.stderr, maxOutputBytes);
  const stdout = outputString(result && result.stdout, maxOutputBytes);
  const details = sanitizeText(redactGithubToken(stderr || stdout, token), { temporaryPaths });
  const error = new GithubSourceError(
    sanitizeText(`GitHub clone failed: ${reason}${details ? `: ${details.trim()}` : ''}`, { temporaryPaths }),
    'GITHUB_CLONE_FAILED'
  );
  error.temporaryPaths = temporaryPaths;
  error.result = {
    ...result,
    stdout: sanitizeText(redactGithubToken(result && result.stdout, token), { temporaryPaths }),
    stderr: sanitizeText(redactGithubToken(result && result.stderr, token), { temporaryPaths }),
    error: sanitizeText(redactGithubToken(result && result.error, token), { temporaryPaths })
  };
  return error;
}

function cloneSucceeded(result, maxOutputBytes) {
  if (!result || typeof result !== 'object') return false;
  const outputBytes = Buffer.byteLength(String(result.stdout || ''), 'utf8')
    + Buffer.byteLength(String(result.stderr || ''), 'utf8');
  return resultExitCode(result) === 0
    && !result.signal
    && !result.timedOut
    && !result.outputTruncated
    && !result.error
    && outputBytes <= maxOutputBytes;
}

function gitVersionSupportsGlobalConfig(result) {
  const output = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`;
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/i.exec(output);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 32);
}

function parseGitFileModes(output) {
  const executablePaths = [];
  const symlinkPaths = [];
  const records = Buffer.isBuffer(output)
    ? output.toString('utf8').split('\0')
    : String(output || '').split('\0');
  for (const record of records) {
    const match = /^(\d{6})\s+\S+\s+\d+\t([\s\S]*)$/.exec(record);
    if (!match || match[2].length === 0) continue;
    if (match[1] === '100755') executablePaths.push(match[2]);
    if (match[1] === '120000') symlinkPaths.push(match[2]);
  }
  return {
    executablePaths: [...new Set(executablePaths)].sort((left, right) => left.localeCompare(right)),
    symlinkPaths: [...new Set(symlinkPaths)].sort((left, right) => left.localeCompare(right))
  };
}

async function removeTemporaryDirectory(directory, options = {}) {
  const remover = typeof options.remover === 'function' ? options.remover : fs.promises.rm;
  if (remover !== fs.promises.rm) {
    let lastError;
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      try {
        await remover(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw lastError;
  }
  await fs.promises.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });
}

/**
 * Clone a validated public GitHub repository into a bounded temporary
 * checkout. The successful result owns the temporary directory; callers must
 * invoke its idempotent cleanup function after consuming the checkout.
 */
async function cloneGithubRepository(value, options = {}) {
  const config = options && typeof options === 'object' ? options : {};
  const source = validateGithubUrl(value);
  const runner = config.runner || runProcess;
  if (typeof runner !== 'function') {
    throw new TypeError('clone runner must be a function');
  }

  const limits = normalizeCloneLimits(config);
  const timeoutMs = normalizePositiveInteger(config.timeoutMs, DEFAULT_CLONE_TIMEOUT_MS, MAX_CLONE_TIMEOUT_MS);
  const maxOutputBytes = normalizePositiveInteger(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
  const hostEnvironment = config.hostEnvironment || process.env;
  const githubToken = githubTokenFromEnvironment(hostEnvironment);
  const removeDirectory = typeof config.removeTemporaryDirectory === 'function'
    ? (directory) => removeTemporaryDirectory(directory, { remover: config.removeTemporaryDirectory })
    : removeTemporaryDirectory;
  const preflight = await preflightGithubRepository(
    source,
    config.fetcher || globalThis.fetch,
    { hostEnvironment }
  );
  const gitExecutable = config.gitExecutable || resolveGitExecutable({
    platform: config.platform || process.platform,
    env: config.hostEnvironment || process.env,
    lookup: config.executableLookup
  });
  if (!gitExecutable) {
    const error = new GithubSourceError(
      'A trusted Git executable was not found.',
      'GITHUB_GIT_UNAVAILABLE'
    );
    error.preflight = preflight.state;
    error.preflightReason = preflight.preflightReason;
    error.preflightAuthenticated = preflight.preflightAuthenticated === true;
    if (preflight.preflightTokenRejected === true) error.preflightTokenRejected = true;
    if (preflight.repositorySizeKb !== undefined) error.repositorySizeKb = preflight.repositorySizeKb;
    throw error;
  }
  let temporaryRoot;
  let temporaryParent;
  let cleanupSupervisor;
  let processPidFile;

  try {
    temporaryParent = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cloneproof-github-'));
    temporaryRoot = path.join(temporaryParent, 'checkout');
    processPidFile = path.join(temporaryParent, 'git.pid');
    const cleanupSupervisorEnabled = config.cleanupSupervisor === true
      || ((config.platform || process.platform) === 'win32' && config.cleanupSupervisor !== false);
    if (cleanupSupervisorEnabled) {
      cleanupSupervisor = startCleanupSupervisor({
        scriptPath: __filename,
        platform: config.platform || process.platform,
        childPidFile: processPidFile,
        cwd: os.tmpdir(),
        env: buildGitCloneInvocation({
          url: source.url,
          checkoutPath: temporaryRoot,
          parentPath: temporaryParent,
          platform: config.platform || process.platform,
          hostEnvironment,
          useGlobalConfig: false
        }).env,
        paths: [temporaryParent]
      });
    }
    await fs.promises.mkdir(temporaryRoot);
    const emptyGitConfig = path.join(temporaryParent, 'empty-gitconfig');
    await fs.promises.writeFile(emptyGitConfig, '', 'utf8');

    const versionInvocation = buildGitCloneInvocation({
      url: source.url,
      checkoutPath: temporaryRoot,
      parentPath: temporaryParent,
      platform: config.platform || process.platform,
      hostEnvironment,
      useGlobalConfig: false
    });
    const versionResult = await runner(gitExecutable, ['--version'], {
      cwd: temporaryParent,
      env: versionInvocation.env,
      shell: false,
      windowsHide: true,
      timeoutMs,
      maxOutputBytes,
      pidFile: processPidFile,
      processGroup: true
    });
    if (!cloneSucceeded(versionResult, maxOutputBytes)) {
      throw new GithubSourceError('Git could not be queried for its version.', 'GITHUB_GIT_UNAVAILABLE');
    }

    const invocation = buildGitCloneInvocation({
      url: source.url,
      checkoutPath: temporaryRoot,
      parentPath: temporaryParent,
      platform: config.platform || process.platform,
      hostEnvironment,
      useGlobalConfig: gitVersionSupportsGlobalConfig(versionResult)
    });
    const result = await runner(gitExecutable, invocation.args, {
      cwd: temporaryParent,
      env: invocation.env,
      shell: false,
      windowsHide: true,
      timeoutMs,
      maxOutputBytes,
      pidFile: processPidFile,
      processGroup: true
    });

    if (!cloneSucceeded(result, maxOutputBytes)) {
      const error = cloneFailure(result, maxOutputBytes, githubToken, [temporaryParent]);
      error.preflightReason = preflight.preflightReason;
      if (preflight.preflightTokenRejected === true) error.preflightTokenRejected = true;
      throw error;
    }

    const metadata = inspectCheckout(temporaryRoot, limits);
    const gitPrefix = invocation.args.slice(0, invocation.args.indexOf('clone'));
    const modeArgs = gitPrefix.concat(['-C', temporaryRoot, 'ls-files', '-s', '-z']);
    let modeResult;
    try {
      modeResult = await runner(gitExecutable, modeArgs, {
        cwd: temporaryParent,
        env: invocation.env,
        shell: false,
        windowsHide: true,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        pidFile: processPidFile,
        processGroup: true
      });
    } catch {
      modeResult = null;
    }
    const modeAvailable = cloneSucceeded(modeResult, MAX_OUTPUT_BYTES);
    const fileModes = modeAvailable
      ? parseGitFileModes(modeResult.stdout)
      : { executablePaths: [], symlinkPaths: [] };

    const commitArgs = gitPrefix.concat(['-C', temporaryRoot, 'rev-parse', 'HEAD']);
    let commitResult;
    try {
      commitResult = await runner(gitExecutable, commitArgs, {
        cwd: temporaryParent,
        env: invocation.env,
        shell: false,
        windowsHide: true,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        pidFile: processPidFile,
        processGroup: true
      });
    } catch {
      commitResult = null;
    }
    let commit;
    if (cloneSucceeded(commitResult, MAX_OUTPUT_BYTES)) {
      const candidate = outputString(commitResult.stdout, MAX_OUTPUT_BYTES).trim();
      if (/^[0-9a-f]{40}$/i.test(candidate)) commit = candidate;
    }

    // The scanner and verifier do not need Git metadata. Removing it keeps the
    // checkout bounds focused on repository content and prevents object data
    // from being handed to later stages.
    await removeDirectory(path.join(temporaryRoot, '.git'));
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      try {
        await removeDirectory(temporaryParent);
        cleaned = true;
        stopCleanupSupervisor(cleanupSupervisor);
      } catch (cleanupError) {
        cleanupError.cleanupDirectory = temporaryParent;
        throw cleanupError;
      }
    };

    return Object.freeze({
      url: source.url,
      owner: source.owner,
      repo: source.repo,
      repository: source.repository,
      preflight: preflight.state,
      preflightReason: preflight.preflightReason,
      preflightAuthenticated: preflight.preflightAuthenticated === true,
      ...(preflight.preflightTokenRejected === true ? { preflightTokenRejected: true } : {}),
      ...(preflight.repositorySizeKb === undefined ? {} : { repositorySizeKb: preflight.repositorySizeKb }),
      executablePaths: fileModes.executablePaths,
      symlinkPaths: fileModes.symlinkPaths,
      executableModes: modeAvailable ? 'checked' : 'unavailable',
      ...(commit === undefined ? {} : { commit }),
      root: temporaryRoot,
      path: temporaryRoot,
      metadata,
      process: {
        exitCode: resultExitCode(result),
        stdout: sanitizeText(outputString(result.stdout, maxOutputBytes), { temporaryPaths: [temporaryParent] }),
        stderr: sanitizeText(outputString(result.stderr, maxOutputBytes), { temporaryPaths: [temporaryParent] }),
        timedOut: Boolean(result.timedOut),
        outputTruncated: Boolean(result.outputTruncated)
      },
      cleanup
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      if (!error.preflight) error.preflight = preflight.state;
      if (!error.preflightReason) error.preflightReason = preflight.preflightReason;
      if (error.preflightAuthenticated === undefined) {
        error.preflightAuthenticated = preflight.preflightAuthenticated === true;
      }
      if (preflight.preflightTokenRejected === true) error.preflightTokenRejected = true;
      if (error.repositorySizeKb === undefined && preflight.repositorySizeKb !== undefined) {
        error.repositorySizeKb = preflight.repositorySizeKb;
      }
      if (error.message) error.message = redactGithubToken(error.message, githubToken);
      if (error.stack) error.stack = redactGithubToken(error.stack, githubToken);
    }
    if (temporaryParent) {
      try {
        await removeDirectory(temporaryParent);
        stopCleanupSupervisor(cleanupSupervisor);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
        error.cleanupDirectory = temporaryParent;
      }
    }
    throw error;
  }
}

if (require.main === module && process.argv[2] === '--cleanup-supervisor') {
  runCleanupSupervisor(process.argv[3]);
}

module.exports = {
  DEFAULT_CLONE_LIMITS,
  MAX_OUTPUT_BYTES,
  MAX_REPOSITORY_BYTES,
  buildGitCloneInvocation,
  cloneGithubRepository,
  inspectCheckout,
  isGithubRepositoryUrl,
  parseGitFileModes,
  preflightGithubRepository,
  removeTemporaryDirectory,
  redactGithubToken,
  validateGithubUrl
};
