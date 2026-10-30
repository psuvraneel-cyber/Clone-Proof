'use strict';

// Prints the CHANGELOG.md section for the package version, after checking
// that an optional release tag names that same version. The release workflow
// uses it as the GitHub release notes; run it locally before tagging.
//
//   node scripts/release-notes.js [--tag vX.Y.Z]

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkReleaseTag(tag, version) {
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package.json version ${version}; expected v${version}.`);
  }
}

function extractReleaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.`);
  }
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line) || /^\[[^\]]+\]:\s/.test(line)) break;
    body.push(line);
  }
  const notes = body.join('\n').trim();
  if (!notes) {
    throw new Error(`CHANGELOG.md section ${version} is empty.`);
  }
  return `${notes}\n`;
}

function main(argv) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tagIndex = argv.indexOf('--tag');
  if (tagIndex >= 0) {
    checkReleaseTag(argv[tagIndex + 1], version);
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  process.stdout.write(extractReleaseNotes(changelog, version));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { checkReleaseTag, extractReleaseNotes };
