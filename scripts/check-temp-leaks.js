'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const POLL_TIMEOUT_MS = 10 * 1000;
const POLL_INTERVAL_MS = 100;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readEntries(directory) {
  try {
    return await fs.promises.readdir(directory);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function waitForDetachedCleanup(directory) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let entries = await readEntries(directory);
  while (entries.length > 0 && Date.now() < deadline) {
    await wait(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    entries = await readEntries(directory);
  }
  return entries;
}

function runTests(environment) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, ['--test'], {
        cwd: projectRoot,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: 'inherit'
      });
    } catch (error) {
      resolve({ exitCode: null, signal: null, error });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once('error', (error) => finish({ exitCode: null, signal: null, error }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal, error: null }));
  });
}

function childFailureStatus(result) {
  if (result.error || result.signal) return 1;
  return typeof result.exitCode === 'number' && result.exitCode !== 0 ? result.exitCode : 0;
}

async function main() {
  const leakRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloneproof-leakcheck-'));
  const environment = {
    ...process.env,
    TEMP: leakRoot,
    TMP: leakRoot,
    TMPDIR: leakRoot
  };

  let result;
  let entries;
  try {
    result = await runTests(environment);
    entries = await waitForDetachedCleanup(leakRoot);
  } catch (error) {
    process.stderr.write(`CloneProof temporary leak check could not inspect ${path.basename(leakRoot)}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (entries.length > 0) {
    process.stderr.write(
      `CloneProof temporary leak check: remaining entries in ${path.basename(leakRoot)}: ${entries.join(', ')}\n`
    );
    process.exitCode = childFailureStatus(result) || 1;
    return;
  }

  try {
    fs.rmSync(leakRoot, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`CloneProof temporary leak check could not remove ${path.basename(leakRoot)}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (result.error) {
    process.stderr.write(`CloneProof temporary leak check could not start node --test: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.signal) {
    process.stderr.write(`CloneProof temporary leak check child exited with signal ${result.signal}.\n`);
    process.exitCode = 1;
    return;
  }
  if (result.exitCode !== 0) {
    process.stderr.write(`CloneProof temporary leak check child exited with code ${result.exitCode}.\n`);
    process.exitCode = result.exitCode || 1;
  }
}

main().catch((error) => {
  process.stderr.write(`CloneProof temporary leak check failed: ${error.message}\n`);
  process.exitCode = 1;
});
