'use strict';

/**
 * Minimal, dependency-free JSON Schema (draft 2020-12) validator for the
 * keyword subset used by CloneProof receipt schemas. Unknown keywords are
 * rejected when a schema is compiled so a schema can never contain a
 * constraint that silently goes unenforced.
 */

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'enum', 'const', 'anyOf',
  'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum',
  'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems'
]);

const SCHEMA_KEYWORDS_WITH_SUBSCHEMAS = new Set(['$defs', 'properties', 'items', 'anyOf']);

function assertSupported(schema, location) {
  if (typeof schema === 'boolean') return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`Invalid schema at ${location}`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) throw new Error(`Unsupported schema keyword "${key}" at ${location}`);
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new Error(`Only additionalProperties: false is supported at ${location}`);
  }
  for (const key of SCHEMA_KEYWORDS_WITH_SUBSCHEMAS) {
    if (schema[key] === undefined) continue;
    if (key === 'items') assertSupported(schema.items, `${location}/items`);
    else if (key === 'anyOf') schema.anyOf.forEach((item, index) => assertSupported(item, `${location}/anyOf/${index}`));
    else for (const [name, item] of Object.entries(schema[key])) assertSupported(item, `${location}/${key}/${name}`);
  }
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function jsonEqual(left, right) {
  if (left === right) return true;
  if (typeOf(left) !== typeOf(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  if (left && typeof left === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return jsonEqual(leftKeys, rightKeys) && leftKeys.every((key) => jsonEqual(left[key], right[key]));
  }
  return false;
}

function compileSchema(rootSchema) {
  assertSupported(rootSchema, '#');
  const patterns = new Map();

  function resolveRef(ref) {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
    if (!match || !rootSchema.$defs || !rootSchema.$defs[match[1]]) throw new Error(`Unresolvable $ref: ${ref}`);
    return rootSchema.$defs[match[1]];
  }

  function regex(pattern) {
    if (!patterns.has(pattern)) patterns.set(pattern, new RegExp(pattern, 'u'));
    return patterns.get(pattern);
  }

  function validate(schema, value, location, errors) {
    if (schema === true) return;
    if (schema === false) {
      errors.push({ path: location, message: 'is not allowed' });
      return;
    }
    if (schema.$ref) {
      validate(resolveRef(schema.$ref), value, location, errors);
    }
    if (schema.anyOf) {
      const matched = schema.anyOf.some((option) => {
        const optionErrors = [];
        validate(option, value, location, optionErrors);
        return optionErrors.length === 0;
      });
      if (!matched) errors.push({ path: location, message: 'does not match any allowed form' });
    }
    if (schema.const !== undefined && !jsonEqual(schema.const, value)) {
      errors.push({ path: location, message: `must equal ${JSON.stringify(schema.const)}` });
    }
    if (schema.enum && !schema.enum.some((item) => jsonEqual(item, value))) {
      errors.push({ path: location, message: `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}` });
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => matchesType(value, type))) {
        errors.push({ path: location, message: `must be of type ${types.join(' or ')}` });
        return;
      }
    }

    if (typeof value === 'string') {
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength) errors.push({ path: location, message: `must be at least ${schema.minLength} characters` });
      if (schema.maxLength !== undefined && length > schema.maxLength) errors.push({ path: location, message: `must be at most ${schema.maxLength} characters` });
      if (schema.pattern !== undefined && !regex(schema.pattern).test(value)) errors.push({ path: location, message: 'has an invalid format' });
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: location, message: `must be >= ${schema.minimum}` });
      if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: location, message: `must be <= ${schema.maximum}` });
    }

    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: location, message: `must contain at least ${schema.minItems} items` });
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: location, message: `must contain at most ${schema.maxItems} items` });
      if (schema.uniqueItems === true) {
        for (let index = 1; index < value.length; index += 1) {
          if (value.slice(0, index).some((item) => jsonEqual(item, value[index]))) {
            errors.push({ path: `${location}/${index}`, message: 'duplicates an earlier item' });
          }
        }
      }
      if (schema.items !== undefined) {
        value.forEach((item, index) => validate(schema.items, item, `${location}/${index}`, errors));
      }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of schema.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ path: `${location}/${key}`, message: 'is required' });
      }
      const properties = schema.properties || {};
      for (const key of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          validate(properties[key], value[key], `${location}/${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push({ path: `${location}/${escapePointer(key)}`, message: 'is not an allowed property' });
        }
      }
    }
  }

  return function validateValue(value) {
    const errors = [];
    validate(rootSchema, value, '', errors);
    return { valid: errors.length === 0, errors };
  };
}

function escapePointer(key) {
  // Bound and neutralize attacker-supplied property names before they reach diagnostics.
  const text = String(key).replace(/~/g, '~0').replace(/\//g, '~1').replace(/[^\x20-\x7e]/g, '?');
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

module.exports = { compileSchema };
