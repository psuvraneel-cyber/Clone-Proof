'use strict';

const crypto = require('node:crypto');
const { CANONICALIZATION_ID, canonicalize } = require('./canonicalize');

const DIGEST_ALGORITHM = 'sha256';
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function digestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Remove the integrity section so the digest never covers itself.
 */
function digestPayload(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw digestError('RECEIPT_DIGEST_INPUT_INVALID', 'Receipt must be a JSON object.');
  }
  const { integrity, ...payload } = receipt;
  return payload;
}

/**
 * SHA-256 over the UTF-8 bytes of the canonical payload (integrity excluded).
 */
function computeDigest(receipt) {
  const canonical = canonicalize(digestPayload(receipt));
  return crypto.createHash(DIGEST_ALGORITHM).update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function attachIntegrity(payload) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'integrity')) {
    throw digestError('RECEIPT_DIGEST_INPUT_INVALID', 'Receipt payload must not already contain an integrity section.');
  }
  return {
    ...payload,
    integrity: {
      algorithm: DIGEST_ALGORITHM,
      canonicalization: CANONICALIZATION_ID,
      digest: computeDigest(payload)
    }
  };
}

/**
 * Recompute and compare the digest. Returns { valid, reason, expected, actual }.
 * A matching digest only shows the content equals what was digested; anyone
 * able to edit the receipt can also recompute the digest.
 */
function verifyDigest(receipt) {
  const integrity = receipt && receipt.integrity;
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
    return { valid: false, reason: 'missing-integrity' };
  }
  if (integrity.algorithm !== DIGEST_ALGORITHM) {
    return { valid: false, reason: 'unsupported-algorithm' };
  }
  if (integrity.canonicalization !== CANONICALIZATION_ID) {
    return { valid: false, reason: 'unsupported-canonicalization' };
  }
  if (typeof integrity.digest !== 'string' || !SHA256_HEX_PATTERN.test(integrity.digest)) {
    return { valid: false, reason: 'malformed-digest' };
  }

  let actual;
  try {
    actual = computeDigest(receipt);
  } catch {
    return { valid: false, reason: 'not-canonicalizable' };
  }
  const expectedBytes = Buffer.from(integrity.digest, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  const valid = expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes);
  return { valid, reason: valid ? null : 'digest-mismatch', expected: integrity.digest, actual };
}

module.exports = {
  DIGEST_ALGORITHM,
  SHA256_HEX_PATTERN,
  attachIntegrity,
  computeDigest,
  digestPayload,
  verifyDigest
};
