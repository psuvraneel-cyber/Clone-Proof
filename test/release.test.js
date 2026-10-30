const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const userDocs = ['README.md', 'docs/GITHUB_ACTION.md', 'docs/DEMO.md'];

function readDoc(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('package version is a plain semantic version', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('user documentation pins the Action to the current release tag', () => {
  let references = 0;
  for (const doc of userDocs) {
    for (const match of readDoc(doc).matchAll(/uses:\s*psuvraneel-cyber\/Clone-Proof@(\S+)/g)) {
      references += 1;
      assert.ok(
        match[1] === `v${version}` || match[1] === '<commit-sha>',
        `${doc} references @${match[1]}; expected @v${version} or @<commit-sha>`
      );
    }
  }
  assert.ok(references > 0, 'expected at least one documented Action reference');
});
