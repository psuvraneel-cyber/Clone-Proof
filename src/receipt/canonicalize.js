'use strict';

const CANONICALIZATION_ID = 'cloneproof-canonical-json-v1';

/**
 * Serialize a JSON value into canonical bytes (as a string).
 *
 * Rules (compatible with RFC 8785 for the value types receipts use):
 * - Object keys are sorted by UTF-16 code units at every depth; insertion
 *   order of the input never affects the output.
 * - Arrays keep their order.
 * - Strings and finite numbers use ECMAScript JSON serialization, so escaping
 *   and number formatting are deterministic (-0 serializes as 0).
 * - No insignificant whitespace is emitted.
 * - undefined, functions, symbols, bigint, NaN, Infinity, non-plain objects
 *   (Date, Map, Buffer, class instances) and circular references are rejected
 *   instead of being silently dropped or coerced.
 */
function canonicalize(value) {
  return serialize(value, new Set(), '$');
}

function fail(message, location) {
  const error = new TypeError(`Cannot canonicalize ${location}: ${message}`);
  error.code = 'RECEIPT_CANONICALIZATION_FAILED';
  return error;
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialize(value, ancestors, location) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw fail('non-finite numbers are not valid JSON', location);
      return JSON.stringify(value);
    case 'undefined':
      throw fail('undefined is not a JSON value', location);
    case 'object':
      break;
    default:
      throw fail(`${typeof value} is not a JSON value`, location);
  }

  if (ancestors.has(value)) throw fail('circular reference', location);

  if (Array.isArray(value)) {
    ancestors.add(value);
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw fail('sparse arrays are not supported', `${location}[${index}]`);
      }
      parts.push(serialize(value[index], ancestors, `${location}[${index}]`));
    }
    ancestors.delete(value);
    return `[${parts.join(',')}]`;
  }

  if (!isPlainObject(value)) throw fail('only plain objects are supported', location);
  if (Object.getOwnPropertySymbols(value).length > 0) throw fail('symbol keys are not supported', location);

  ancestors.add(value);
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    parts.push(`${JSON.stringify(key)}:${serialize(value[key], ancestors, `${location}.${key}`)}`);
  }
  ancestors.delete(value);
  return `{${parts.join(',')}}`;
}

/**
 * Return a deep copy of a JSON value with keys sorted, suitable for
 * deterministic human-readable output with JSON.stringify(value, null, 2).
 */
function sortedCopy(value) {
  return JSON.parse(canonicalize(value));
}

module.exports = { CANONICALIZATION_ID, canonicalize, sortedCopy };
