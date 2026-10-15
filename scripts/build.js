const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');

function collectJavaScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

for (const file of collectJavaScriptFiles(sourceRoot)) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

process.stdout.write(`Checked ${collectJavaScriptFiles(sourceRoot).length} source files.\n`);
