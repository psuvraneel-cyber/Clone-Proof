'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Read the checked-out commit of a local Git working tree without starting
 * any process. Only HEAD, commondir, the referenced loose ref, and
 * packed-refs are read, each with a byte bound, so repository-controlled
 * configuration, hooks, filters, and aliases are never consulted or run.
 */

const MAX_SEARCH_DEPTH = 64;
const MAX_SMALL_FILE_BYTES = 4096;
const MAX_PACKED_REFS_BYTES = 8 * 1024 * 1024;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const REF_PATTERN = /^(?!.*\.\.)(?!.*\/\/)(?!.*\/$)refs\/(?:heads|tags|remotes|pull)\/[A-Za-z0-9._/+-]{1,240}$/;

function readBounded(filePath, maxBytes) {
  let descriptor;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* ignore close failure */ }
    }
  }
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate the working-tree root containing startDirectory. The search stops at
 * ceilingDirectory (inclusive) when provided.
 */
function findCheckoutRoot(startDirectory, ceilingDirectory) {
  let current = path.resolve(startDirectory);
  const ceiling = ceilingDirectory ? path.resolve(ceilingDirectory) : null;
  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth += 1) {
    const marker = path.join(current, '.git');
    let stat = null;
    try {
      stat = fs.lstatSync(marker);
    } catch {
      stat = null;
    }
    if (stat && (stat.isDirectory() || stat.isFile())) return { root: current, marker, markerIsFile: stat.isFile() };
    if (ceiling && samePath(current, ceiling)) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function resolveGitDirectories(checkout) {
  let gitDirectory = checkout.marker;
  if (checkout.markerIsFile) {
    const content = readBounded(checkout.marker, MAX_SMALL_FILE_BYTES);
    const match = content && /^gitdir: (.+?)\s*$/m.exec(content);
    if (!match) return null;
    gitDirectory = path.resolve(checkout.root, match[1]);
  }
  if (!isDirectory(gitDirectory)) return null;

  let commonDirectory = gitDirectory;
  const commonDir = readBounded(path.join(gitDirectory, 'commondir'), MAX_SMALL_FILE_BYTES);
  if (commonDir !== null) {
    const value = commonDir.trim();
    if (!value || value.includes('\n')) return null;
    commonDirectory = path.resolve(gitDirectory, value);
    if (!isDirectory(commonDirectory)) return null;
  }
  return { gitDirectory, commonDirectory };
}

function lookupRef(directories, ref) {
  for (const directory of [directories.gitDirectory, directories.commonDirectory]) {
    const loose = readBounded(path.join(directory, ...ref.split('/')), MAX_SMALL_FILE_BYTES);
    if (loose !== null) {
      const value = loose.trim();
      return FULL_SHA_PATTERN.test(value) ? value : null;
    }
  }
  const packed = readBounded(path.join(directories.commonDirectory, 'packed-refs'), MAX_PACKED_REFS_BYTES);
  if (packed === null) return null;
  for (const line of packed.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
    const [sha, name] = trimmed.split(' ');
    if (name === ref) return FULL_SHA_PATTERN.test(sha) ? sha : null;
  }
  return null;
}

function relativeSubdirectory(root, target) {
  const relative = path.relative(root, target).split(path.sep).join('/');
  return relative === '' ? '.' : relative;
}

/**
 * Returns { commit, ref, subdirectory, checkoutRoot } with null values for
 * anything that could not be established. Never throws.
 */
function readLocalGitMetadata(targetDirectory, options = {}) {
  const empty = { commit: null, ref: null, subdirectory: null, checkoutRoot: null };
  try {
    const checkout = findCheckoutRoot(targetDirectory, options.ceilingDirectory);
    if (!checkout) return empty;
    const directories = resolveGitDirectories(checkout);
    if (!directories) return empty;
    const head = readBounded(path.join(directories.gitDirectory, 'HEAD'), MAX_SMALL_FILE_BYTES);
    if (head === null) return empty;
    const headValue = head.trim();
    const located = { ...empty, subdirectory: relativeSubdirectory(checkout.root, path.resolve(targetDirectory)), checkoutRoot: checkout.root };

    if (FULL_SHA_PATTERN.test(headValue)) {
      return { ...located, commit: headValue };
    }
    const symbolic = /^ref: (\S+)$/.exec(headValue);
    if (!symbolic || !REF_PATTERN.test(symbolic[1])) return located;
    const commit = lookupRef(directories, symbolic[1]);
    return { ...located, commit, ref: commit ? symbolic[1] : null };
  } catch {
    return empty;
  }
}

module.exports = { FULL_SHA_PATTERN, REF_PATTERN, findCheckoutRoot, readLocalGitMetadata };
