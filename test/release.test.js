const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkReleaseTag, extractReleaseNotes } = require('../scripts/release-notes');

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

test('CHANGELOG has a dated, non-empty section for the package version', () => {
  const notes = extractReleaseNotes(readDoc('CHANGELOG.md'), version);
  assert.match(notes, /\S/);
  assert.doesNotMatch(notes, /^## \[/m);
});

test('release notes extraction stops at the next section and link definitions', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.2.3] - 2026-01-02',
    '',
    '### Fixed',
    '',
    '- One fix.',
    '',
    '## [1.2.2] - 2026-01-01',
    '',
    '- Older entry.',
    '',
    '[1.2.3]: https://example.invalid/1.2.3'
  ].join('\r\n');
  assert.equal(extractReleaseNotes(changelog, '1.2.3'), '### Fixed\n\n- One fix.\n');
  assert.equal(extractReleaseNotes(changelog, '1.2.2'), '- Older entry.\n');
  assert.throws(() => extractReleaseNotes(changelog, '9.9.9'), /no "## \[9\.9\.9\] - YYYY-MM-DD" section/);
  assert.throws(() => extractReleaseNotes('## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-01-01\n- x\n', '1.0.0'), /is empty/);
  assert.throws(() => extractReleaseNotes('## [1.2.3]\n\n- undated\n', '1.2.3'), /no "## \[1\.2\.3\]/);
});

test('release tags must name the package version exactly', () => {
  assert.doesNotThrow(() => checkReleaseTag('v1.2.3', '1.2.3'));
  for (const tag of ['1.2.3', 'v1.2.4', 'v1.2.3-rc.1', undefined]) {
    assert.throws(() => checkReleaseTag(tag, '1.2.3'), /does not match package\.json version 1\.2\.3/);
  }
});

test('every workflow pins third-party actions to full commit SHAs', () => {
  const workflowsDir = path.join(root, '.github', 'workflows');
  for (const file of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const text = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      const reference = match[1];
      if (reference.startsWith('./')) continue;
      assert.match(reference, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file} uses unpinned ${reference}`);
    }
  }
});

test('release workflow publishes only from version tags on main', () => {
  const text = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /^on:\n {2}push:\n {4}tags:\n {6}- 'v\*\.\*\.\*'\n {2}workflow_dispatch:\n/m);
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  assert.match(text, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(text, /node scripts\/release-notes\.js --tag "\$GITHUB_REF_NAME"/);
  for (const step of ['Require the tagged commit to be on main', 'Attest build provenance', 'Publish GitHub release', 'Publish to npm']) {
    const block = text.slice(text.indexOf(`- name: ${step}`));
    assert.match(block, /^ {8}if: github\.event_name == 'push'$/m, `${step} must run only for tag pushes`);
    assert.ok(block.indexOf("if: github.event_name == 'push'") < (block.indexOf('\n      - name:', 1) >>> 0), `${step} guard must belong to that step`);
  }
  assert.doesNotMatch(text, /\$\{\{\s*github\.(ref_name|head_ref|event\.)/, 'tag names must reach scripts through environment variables');
});

test('documented install commands reference the current release, never a branch', () => {
  let releaseUrls = 0;
  for (const doc of userDocs) {
    const text = readDoc(doc);
    assert.doesNotMatch(text, /Clone-Proof\/archive\/refs\/heads\//, `${doc} installs from a branch archive`);
    for (const match of text.matchAll(/Clone-Proof\/releases\/(?:download|tag)\/v(\d+\.\d+\.\d+)(?:\/cloneproof-check-(\d+\.\d+\.\d+)\.tgz)?/g)) {
      releaseUrls += 1;
      assert.equal(match[1], version, `${doc} links release v${match[1]}`);
      if (match[2]) assert.equal(match[2], version, `${doc} links tarball ${match[2]}`);
    }
    for (const match of text.matchAll(/github:psuvraneel-cyber\/Clone-Proof(#\S+)?/g)) {
      assert.equal(match[1], `#v${version}`, `${doc} runs npx from ${match[1] || 'the default branch'}`);
    }
    for (const match of text.matchAll(/clone-?proof(?:-check)?-(\d+\.\d+\.\d+)\.tgz/g)) {
      assert.equal(match[0], `cloneproof-check-${version}.tgz`, `${doc} names tarball ${match[0]}`);
    }
  }
  assert.ok(releaseUrls > 0, 'expected a documented release download URL');
});

test('documented npm installs use the cloneproof-check package name', () => {
  const { name, bin } = JSON.parse(readDoc('package.json'));
  assert.equal(name, 'cloneproof-check');
  assert.equal(bin.cloneproof, 'src/cli.js');
  for (const doc of userDocs) {
    const text = readDoc(doc);
    assert.doesNotMatch(text, /npm (?:install|i) (?:-g|--global) cloneproof(?:@|\s|$)/m, `${doc} installs the unrelated cloneproof package`);
    assert.doesNotMatch(text, /npx cloneproof(?:@|\s|$)/m, `${doc} runs the unrelated cloneproof package`);
    // npm rejected clone-proof as too similar to cloneproof, so it was never published.
    assert.doesNotMatch(text, /(?:npx|npm (?:install|i) (?:-g|--global)) clone-proof(?:@|\s|$)/m, `${doc} uses the unpublished clone-proof name`);
  }
});

test('the published package ships the changelog', () => {
  const { files } = JSON.parse(readDoc('package.json'));
  assert.ok(files.includes('CHANGELOG.md'));
  const ci = readDoc('.github/workflows/ci.yml');
  assert.match(ci, /'CHANGELOG\.md',\s*\n\s*'LICENSE',/, 'CI pack-content check must expect CHANGELOG.md');
});
