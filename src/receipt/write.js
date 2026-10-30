'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sortedCopy } = require('./canonicalize');

/**
 * Deterministic on-disk form: keys sorted at every depth, two-space
 * indentation, trailing newline. The digest is computed separately over the
 * compact canonical form, so formatting never affects verification.
 */
function serializeReceipt(receipt) {
  return `${JSON.stringify(sortedCopy(receipt), null, 2)}\n`;
}

function writeError(message, cause) {
  const error = new Error(message);
  error.code = 'RECEIPT_WRITE_FAILED';
  if (cause && cause.code) error.causeCode = cause.code;
  return error;
}

/**
 * Write content to destination atomically: a uniquely named temporary file in
 * the same directory is written, flushed, closed, and renamed over the
 * destination. The temporary file is removed on any failure, so a partially
 * written receipt is never left at the destination.
 */
function writeFileAtomic(destination, content) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o644);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* ignore close failure */ }
    }
    try { fs.rmSync(temporary, { force: true }); } catch { /* ignore cleanup failure */ }
    throw writeError('The receipt file could not be written.', error);
  }
}

module.exports = { serializeReceipt, writeFileAtomic };
