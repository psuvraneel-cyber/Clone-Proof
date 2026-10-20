'use strict';

const os = require('node:os');

function pathVariants(value) {
  if (value === undefined || value === null) return [];
  const text = String(value).replace(/[\\/]+$/, '');
  if (!text) return [];
  return [...new Set([
    text,
    text.replace(/\\/g, '/'),
    text.replace(/\//g, '\\')
  ])].sort((left, right) => right.length - left.length);
}

function replacePathPrefix(text, value, replacement, caseInsensitive) {
  let result = text;
  for (const variant of pathVariants(value)) {
    const needle = caseInsensitive ? variant.toLowerCase() : variant;
    let offset = 0;
    while (offset < result.length) {
      const haystack = caseInsensitive ? result.toLowerCase() : result;
      const index = haystack.indexOf(needle, offset);
      if (index < 0) break;
      const end = index + variant.length;
      if (end === result.length || !/[A-Za-z0-9_.-]/.test(result[end])) {
        result = `${result.slice(0, index)}${replacement}${result.slice(end)}`;
        offset = index + replacement.length;
      } else {
        offset = end;
      }
    }
  }
  return result;
}

function sanitizeText(value, options = {}) {
  let result = value === undefined || value === null ? '' : String(value);
  const platform = options.platform || process.platform;
  const caseInsensitive = platform === 'win32';
  const temporaryPaths = Array.isArray(options.temporaryPaths) ? options.temporaryPaths : [];

  for (const temporaryPath of temporaryPaths) {
    result = replacePathPrefix(result, temporaryPath, '<temporary-checkout>', caseInsensitive);
  }
  result = replacePathPrefix(result, options.tempDirectory || os.tmpdir(), '<temp>', caseInsensitive);
  result = replacePathPrefix(result, options.homeDirectory || os.homedir(), '~', caseInsensitive);
  return result;
}

function sanitizeValue(value, options = {}) {
  if (typeof value === 'string') return sanitizeText(value, options);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, options));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = sanitizeValue(item, options);
  }
  return result;
}

function sanitizeInPlace(value, options = {}) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = typeof value[index] === 'string'
        ? sanitizeText(value[index], options)
        : sanitizeInPlace(value[index], options);
    }
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, item] of Object.entries(value)) {
    value[key] = typeof item === 'string'
      ? sanitizeText(item, options)
      : sanitizeInPlace(item, options);
  }
  return value;
}

module.exports = { sanitizeInPlace, sanitizeText, sanitizeValue };
