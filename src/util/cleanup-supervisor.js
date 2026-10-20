'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLEANUP_RETRIES = 10;
const CLEANUP_RETRY_DELAY_MS = 100;
const SUPERVISOR_POLL_DELAY_MS = 100;
const SUPERVISOR_COMMAND_TIMEOUT_MS = 5000;
const SUPERVISOR_CLEANUP_TIMEOUT_MS = 30000;
const SUPERVISOR_BACKOFF_INITIAL_MS = 100;
const SUPERVISOR_BACKOFF_MAX_MS = 1000;

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function removePathWithRetries(directory, deadline) {
  let lastError;
  let attempt = 0;
  while (attempt === 0 || Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      lastError = error;
      const delay = Math.min(SUPERVISOR_BACKOFF_INITIAL_MS * (2 ** attempt), SUPERVISOR_BACKOFF_MAX_MS);
      if (Date.now() + delay >= deadline) break;
      sleepSync(delay);
      attempt += 1;
    }
  }
  return !lastError;
}

function removeSupervisorPaths(paths) {
  const deadline = Date.now() + SUPERVISOR_CLEANUP_TIMEOUT_MS;
  let completed = true;
  for (const directory of [...new Set(Array.isArray(paths) ? paths : [])]) {
    if (!removePathWithRetries(directory, deadline)) completed = false;
  }
  return completed;
}

function readChildPid(payload) {
  const direct = Number(payload.childPid);
  if (Number.isInteger(direct) && direct > 0) return direct;
  if (typeof payload.childPidFile !== 'string' || payload.childPidFile.length === 0) return null;
  try {
    const value = Number(fs.readFileSync(payload.childPidFile, 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function waitForChildProcess(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, options);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(success);
    };
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(false);
    }, SUPERVISOR_COMMAND_TIMEOUT_MS);
    child.once('error', () => finish(false));
    child.once('close', (exitCode) => finish(exitCode === 0));
  });
}

async function stopChildProcessTree(payload) {
  const pid = readChildPid(payload);
  if (!pid) return false;
  if (payload.platform === 'win32') {
    const systemRoot = payload.env && (payload.env.SystemRoot || payload.env.WINDIR)
      || process.env.SystemRoot
      || process.env.WINDIR
      || 'C:\\Windows';
    const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    return waitForChildProcess(taskkill, ['/PID', String(pid), '/T', '/F'], {
      cwd: payload.cwd || os.tmpdir(),
      env: payload.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    });
  }

  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform !== 'win32' && fs.existsSync('/proc')) {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
        if (state === 'Z') return false;
      } catch {
        // The process may have exited between kill(0) and reading /proc.
      }
    }
    return true;
  } catch (error) {
    return Boolean(error && error.code !== 'ESRCH');
  }
}

function runCleanupSupervisor(payloadValue) {
  let payload;
  try {
    payload = JSON.parse(payloadValue);
  } catch {
    process.exitCode = 2;
    return;
  }

  const parentPid = Number(payload.parentPid);
  if (
    !Number.isInteger(parentPid)
    || parentPid <= 0
    || (payload.command !== undefined && typeof payload.command !== 'string')
    || (payload.platform !== undefined && typeof payload.platform !== 'string')
    || (payload.childPidFile !== undefined && typeof payload.childPidFile !== 'string')
    || !Array.isArray(payload.args)
    || !Array.isArray(payload.paths)
  ) {
    process.exitCode = 2;
    return;
  }

  const cleanupPaths = () => {
    const completed = removeSupervisorPaths(payload.paths);
    process.exitCode = completed ? 0 : 1;
  };

  const runCommandThenCleanup = async () => {
    await stopChildProcessTree(payload);
    if (!payload.command) {
      cleanupPaths();
      return;
    }

    let cleanup;
    try {
      cleanup = spawn(payload.command, payload.args, {
        cwd: payload.cwd || os.tmpdir(),
        env: payload.env || process.env,
        shell: false,
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch {
      cleanupPaths();
      process.exitCode = 1;
      return;
    }

    let settled = false;
    let timeout;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const completed = removeSupervisorPaths(payload.paths);
      process.exitCode = completed && exitCode === 0 ? 0 : 1;
    };

    timeout = setTimeout(() => {
      if (!settled) {
        try {
          cleanup.kill('SIGKILL');
        } catch {
          // The close/error event still completes cleanup when possible.
        }
      }
      finish(1);
    }, SUPERVISOR_COMMAND_TIMEOUT_MS);
    cleanup.once('error', () => finish(1));
    cleanup.once('close', (exitCode) => finish(exitCode === 0 ? 0 : 1));
  };

  const poll = setInterval(() => {
    if (processIsAlive(parentPid)) return;
    clearInterval(poll);
    void runCommandThenCleanup();
  }, SUPERVISOR_POLL_DELAY_MS);
}

function startCleanupSupervisor(options = {}) {
  if (typeof options.scriptPath !== 'string' || options.scriptPath.length === 0) return null;

  const payload = {
    parentPid: process.pid,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.childPid === undefined ? {} : { childPid: options.childPid }),
    ...(options.childPidFile === undefined ? {} : { childPidFile: options.childPidFile }),
    ...(options.command === undefined ? {} : { command: options.command }),
    args: Array.isArray(options.args) ? options.args : [],
    cwd: options.cwd || os.tmpdir(),
    env: options.env || process.env,
    paths: Array.isArray(options.paths) ? options.paths : []
  };

  let supervisor;
  try {
    supervisor = spawn(
      process.execPath,
      [options.scriptPath, '--cleanup-supervisor', JSON.stringify(payload)],
      {
        cwd: payload.cwd,
        env: payload.env,
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      }
    );
  } catch {
    return null;
  }

  supervisor.once('error', () => {});
  supervisor.unref();
  return supervisor;
}

function stopCleanupSupervisor(supervisor) {
  if (!supervisor || supervisor.exitCode !== null) return;
  try {
    supervisor.kill('SIGTERM');
  } catch {
    // The supervisor may already have observed verifier process exit.
  }
}

module.exports = {
  CLEANUP_RETRIES,
  CLEANUP_RETRY_DELAY_MS,
  SUPERVISOR_CLEANUP_TIMEOUT_MS,
  processIsAlive,
  removeSupervisorPaths,
  runCleanupSupervisor,
  startCleanupSupervisor,
  stopCleanupSupervisor
};
