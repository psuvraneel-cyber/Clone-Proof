'use strict';

const path = require('node:path');

/**
 * Normalizes a filesystem path for cross-platform comparison,
 * folding case on Windows to avoid drive-letter or casing mismatches.
 */
function normalizePathForComparison(targetPath) {
  let resolved = path.resolve(targetPath);
  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
  }
  return resolved;
}

/**
 * Checks whether childPath is lexically contained inside parentPath.
 */
function isSubPath(parentPath, childPath) {
  const normParent = normalizePathForComparison(parentPath);
  const normChild = normalizePathForComparison(childPath);
  const rel = path.relative(normParent, normChild);
  if (rel === '') return true;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

module.exports = {
  isSubPath,
  normalizePathForComparison
};
