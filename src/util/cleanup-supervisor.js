'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const CLEANUP_RETRIES = 10;
const CLEANUP_RETRY_DELAY_MS = 100;
const SUPERVISOR_POLL_DELAY_MS = 100;
const SUPERVISOR_COMMAND_TIMEOUT_MS = 5000;

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function removePathWithRetries(directory) {
  let lastError;
  for (let attempt = 0; attempt <= CLEANUP_RETRIES; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < CLEANUP_RETRIES) sleepSync(CLEANUP_RETRY_DELAY_MS);
    }
  }
  return !lastError;
}

function removeSupervisorPaths(paths) {
  let completed = true;
  for (const directory of [...new Set(Array.isArray(paths) ? paths : [])]) {
    if (!removePathWithRetries(directory)) completed = false;
  }
  return completed;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
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

  const runCommandThenCleanup = () => {
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
    runCommandThenCleanup();
  }, SUPERVISOR_POLL_DELAY_MS);
}

function startCleanupSupervisor(options = {}) {
  if (typeof options.scriptPath !== 'string' || options.scriptPath.length === 0) return null;

  const payload = {
    parentPid: process.pid,
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
  processIsAlive,
  removeSupervisorPaths,
  runCleanupSupervisor,
  startCleanupSupervisor,
  stopCleanupSupervisor
};
