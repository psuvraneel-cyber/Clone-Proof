const test = require('node:test');
const assert = require('node:assert/strict');
const { appName } = require('../src/index');

test('returns a safe default application name', () => {
  assert.equal(appName(), 'CloneProof demo');
});
