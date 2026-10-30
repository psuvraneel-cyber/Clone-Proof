'use strict';

const { CANONICALIZATION_ID, canonicalize } = require('./canonicalize');
const { computeDigest, verifyDigest } = require('./digest');
const { RECEIPT_TYPE, RECEIPT_VERSION, createReceipt } = require('./create');
const { readLocalGitMetadata } = require('./git-metadata');
const { MAX_RECEIPT_BYTES, assertValidReceipt, validateReceipt, verifyReceiptContent } = require('./validate');
const { serializeReceipt, writeFileAtomic } = require('./write');

module.exports = {
  CANONICALIZATION_ID,
  MAX_RECEIPT_BYTES,
  RECEIPT_TYPE,
  RECEIPT_VERSION,
  assertValidReceipt,
  canonicalize,
  computeDigest,
  createReceipt,
  readLocalGitMetadata,
  serializeReceipt,
  validateReceipt,
  verifyDigest,
  verifyReceiptContent,
  writeFileAtomic
};
