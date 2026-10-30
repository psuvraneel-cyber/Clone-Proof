'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { CANONICALIZATION_ID, canonicalize, sortedCopy } = require('../src/receipt/canonicalize');
const { attachIntegrity, computeDigest, digestPayload, verifyDigest } = require('../src/receipt/digest');

test('canonicalization ignores object insertion order at every depth', () => {
  const left = { b: 1, a: { d: [1, { z: true, y: null }], c: 'x' } };
  const right = { a: { c: 'x', d: [1, { y: null, z: true }] }, b: 1 };
  assert.equal(canonicalize(left), canonicalize(right));
  assert.equal(canonicalize(left), '{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}');
});

test('canonicalization preserves array order', () => {
  assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  assert.notEqual(canonicalize(['a', 'b']), canonicalize(['b', 'a']));
});

test('canonicalization sorts keys by UTF-16 code units, not locale', () => {
  assert.equal(canonicalize({ b: 1, B: 2, a: 3, _: 4, é: 5 }), '{"B":2,"_":4,"a":3,"b":1,"é":5}');
});

test('canonicalization preserves Unicode and uses JSON escaping', () => {
  assert.equal(canonicalize('naïve – 日本 🚀'), '"naïve – 日本 🚀"');
  assert.equal(canonicalize('quote " backslash \\ newline \n tab \t nul \u0000'), '"quote \\" backslash \\\\ newline \\n tab \\t nul \\u0000"');
  assert.equal(canonicalize('\ud800'), '"\\ud800"');
  const value = { text: 'Zürich ' };
  assert.deepEqual(JSON.parse(canonicalize(value)), value);
});

test('canonicalization uses JSON number serialization', () => {
  assert.equal(canonicalize([0, -0, 1.5, 1e21, 1e-7, -42, 9007199254740991]), '[0,0,1.5,1e+21,1e-7,-42,9007199254740991]');
});

test('canonicalization serializes null and booleans', () => {
  assert.equal(canonicalize({ a: null, b: true, c: false }), '{"a":null,"b":true,"c":false}');
  assert.equal(canonicalize(null), 'null');
});

test('canonicalization rejects undefined values instead of dropping them', () => {
  assert.throws(() => canonicalize({ a: undefined }), /undefined is not a JSON value/);
  assert.throws(() => canonicalize([undefined]), /undefined/);
  assert.throws(() => canonicalize(undefined), /undefined/);
});

test('canonicalization rejects NaN and Infinity', () => {
  assert.throws(() => canonicalize({ a: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalize([Number.POSITIVE_INFINITY]), /non-finite/);
  assert.throws(() => canonicalize(Number.NEGATIVE_INFINITY), /non-finite/);
});

test('canonicalization rejects circular references but allows repeated siblings', () => {
  const circular = { a: {} };
  circular.a.self = circular;
  assert.throws(() => canonicalize(circular), /circular reference/);
  const array = [];
  array.push(array);
  assert.throws(() => canonicalize(array), /circular reference/);

  const shared = { x: 1 };
  assert.equal(canonicalize({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
});

test('canonicalization rejects non-JSON types', () => {
  for (const value of [() => 1, Symbol('s'), 10n, new Date(0), new Map(), Buffer.from('x'), new (class Example {})()]) {
    assert.throws(() => canonicalize({ value }), (error) => error.code === 'RECEIPT_CANONICALIZATION_FAILED');
  }
  assert.throws(() => canonicalize({ [Symbol('k')]: 1 }), /symbol keys/);
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => canonicalize([1, , 3]), /sparse/);
});

test('canonicalization accepts null-prototype objects', () => {
  const value = Object.create(null);
  value.b = 2;
  value.a = 1;
  assert.equal(canonicalize(value), '{"a":1,"b":2}');
});

test('sortedCopy is deterministic and stable for formatting', () => {
  const first = JSON.stringify(sortedCopy({ z: 1, a: { y: 2, b: 3 } }), null, 2);
  const second = JSON.stringify(sortedCopy({ a: { b: 3, y: 2 }, z: 1 }), null, 2);
  assert.equal(first, second);
});

test('digest is SHA-256 over canonical UTF-8 bytes and excludes the integrity section', () => {
  const payload = { receiptVersion: 1, text: 'héllo', nested: { b: 2, a: 1 } };
  const expected = crypto.createHash('sha256').update(Buffer.from(canonicalize(payload), 'utf8')).digest('hex');
  assert.equal(computeDigest(payload), expected);

  const withIntegrity = attachIntegrity(payload);
  assert.equal(withIntegrity.integrity.algorithm, 'sha256');
  assert.equal(withIntegrity.integrity.canonicalization, CANONICALIZATION_ID);
  assert.equal(withIntegrity.integrity.digest, expected);
  // Recomputing over the final receipt ignores integrity, so the digest is not circular.
  assert.equal(computeDigest(withIntegrity), expected);
  assert.deepEqual(digestPayload(withIntegrity), payload);
  assert.throws(() => attachIntegrity(withIntegrity), /must not already contain an integrity section/);
});

test('digest verification passes for an untouched payload regardless of key order', () => {
  const receipt = attachIntegrity({ b: [1, 2], a: { y: 'x', x: 'y' } });
  const reordered = { integrity: receipt.integrity, a: { x: 'y', y: 'x' }, b: [1, 2] };
  assert.equal(verifyDigest(receipt).valid, true);
  assert.equal(verifyDigest(reordered).valid, true);
});

test('digest verification detects modified, added, and removed fields', () => {
  const receipt = attachIntegrity({ a: 1, b: { c: 'x' }, list: [1, 2] });
  const modified = { ...receipt, a: 2 };
  const added = { ...receipt, extra: true };
  const { b, ...removed } = receipt;
  const reordered = { ...receipt, list: [2, 1] };
  for (const candidate of [modified, added, removed, reordered]) {
    const result = verifyDigest(candidate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'digest-mismatch');
  }
  assert.ok(b);
});

test('digest verification rejects malformed digests and unsupported algorithms', () => {
  const receipt = attachIntegrity({ a: 1 });
  const variants = [
    [{ ...receipt.integrity, digest: receipt.integrity.digest.slice(0, 63) }, 'malformed-digest'],
    [{ ...receipt.integrity, digest: `${receipt.integrity.digest}0` }, 'malformed-digest'],
    [{ ...receipt.integrity, digest: receipt.integrity.digest.toUpperCase() }, 'malformed-digest'],
    [{ ...receipt.integrity, digest: `${receipt.integrity.digest.slice(0, 63)}g` }, 'malformed-digest'],
    [{ ...receipt.integrity, digest: 42 }, 'malformed-digest'],
    [{ ...receipt.integrity, algorithm: 'sha1' }, 'unsupported-algorithm'],
    [{ ...receipt.integrity, algorithm: 'SHA256' }, 'unsupported-algorithm'],
    [{ ...receipt.integrity, canonicalization: 'jcs' }, 'unsupported-canonicalization']
  ];
  for (const [integrity, reason] of variants) {
    assert.equal(verifyDigest({ ...receipt, integrity }).reason, reason);
  }
  const { integrity, ...withoutIntegrity } = receipt;
  assert.ok(integrity);
  assert.equal(verifyDigest(withoutIntegrity).reason, 'missing-integrity');
  assert.equal(verifyDigest({ ...receipt, integrity: [] }).reason, 'missing-integrity');
});

test('digest verification reports non-canonicalizable content instead of throwing', () => {
  const receipt = attachIntegrity({ a: 1 });
  assert.equal(verifyDigest({ ...receipt, a: Number.NaN }).reason, 'not-canonicalizable');
});
