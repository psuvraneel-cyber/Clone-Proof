'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  NOT_CHECKED,
  createCoverageTracker,
  assertCoverageConsistency
} = require('../report/coverage');

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 25,
  maxFiles: 10000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxLockfileBytes: 32 * 1024 * 1024,
  maxEntries: 200000
});

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.yarn',
  '.pnpm-store',
  '.vercel',
  'bower_components'
]);
const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx'
]);
const LOCKFILES = [
  { name: 'package-lock.json', packageManager: 'npm' },
  { name: 'npm-shrinkwrap.json', packageManager: 'npm' },
  { name: 'pnpm-lock.yaml', packageManager: 'pnpm' },
  { name: 'yarn.lock', packageManager: 'yarn' }
];
const PUBLIC_REGISTRY_HOSTNAMES = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com'
]);
const PUBLIC_GIT_HOSTNAMES = new Set([
  'github.com',
  'codeload.github.com',
  'gitlab.com',
  'bitbucket.org'
]);
const LIKELY_SERVICE_DEPENDENCIES = new Set([
  'pg',
  'mysql2',
  'mongoose',
  'mongodb',
  'redis',
  'ioredis',
  'amqplib'
]);
const OTHER_ECOSYSTEM_MARKERS = [
  { names: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], ecosystem: 'Python' },
  { names: ['go.mod'], ecosystem: 'Go' },
  { names: ['Cargo.toml'], ecosystem: 'Rust' },
  { names: ['pom.xml', 'build.gradle', 'build.gradle.kts'], ecosystem: 'Java' },
  { names: ['Gemfile'], ecosystem: 'Ruby' },
  { names: ['composer.json'], ecosystem: 'PHP' },
  { names: ['mix.exs'], ecosystem: 'Elixir' },
  { names: ['CMakeLists.txt'], ecosystem: 'C/C++' }
];
const CONVENTIONAL_ENV_KEYS = new Set([
  'PATH',
  'Path',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramW6432',
  'ProgramData',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SHELL',
  'TERM',
  'LANG',
  'TZ',
  'PWD',
  'CI',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NO_COLOR',
  'FORCE_COLOR',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLUMNS',
  'DEBUG',
  'NODE_DEBUG',
  'NODE_PATH',
  'PATHEXT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy'
]);
const ENVIRONMENT_ANALYSIS_EXCLUDED_FIRST_SEGMENTS = new Set([
  'scripts',
  'script',
  'tools',
  'examples',
  'example',
  'benchmark',
  'benchmarks',
  'bench',
  'docs',
  'doc',
  'website'
]);
const ENVIRONMENT_ANALYSIS_EXCLUDED_SEGMENTS = new Set([
  'fixtures',
  '__fixtures__',
  '__mocks__'
]);

function isConventionalEnvironmentKey(key) {
  return CONVENTIONAL_ENV_KEYS.has(key)
    || key.startsWith('npm_')
    || key.startsWith('GITHUB_')
    || key.startsWith('RUNNER_');
}

function isEnvironmentAnalysisExcludedPath(relativePath) {
  const normalized = String(relativePath).split('\\').join('/');
  const segments = normalized.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.length === 0) return false;
  if (ENVIRONMENT_ANALYSIS_EXCLUDED_FIRST_SEGMENTS.has(segments[0])) return true;
  if (segments.some((segment) => ENVIRONMENT_ANALYSIS_EXCLUDED_SEGMENTS.has(segment))) return true;
  if (segments.length !== 1) return false;

  return /^.+\.config\.(?:js|cjs|mjs|ts|cts|mts)$/.test(segments[0])
    || /^\.eslintrc\..+$/.test(segments[0])
    || /^gulpfile\..+$/.test(segments[0])
    || /^gruntfile\..+$/.test(segments[0]);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeLimit(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeLimits(options) {
  const optionObject = options && typeof options === 'object' ? options : {};
  const nested = optionObject.limits && typeof optionObject.limits === 'object'
    ? optionObject.limits
    : {};

  return {
    maxDepth: normalizeLimit(
      optionObject.maxDepth === undefined ? nested.maxDepth : optionObject.maxDepth,
      DEFAULT_LIMITS.maxDepth
    ),
    maxFiles: normalizeLimit(
      optionObject.maxFiles === undefined ? nested.maxFiles : optionObject.maxFiles,
      DEFAULT_LIMITS.maxFiles
    ),
    maxFileBytes: normalizeLimit(
      optionObject.maxFileBytes === undefined ? nested.maxFileBytes : optionObject.maxFileBytes,
      DEFAULT_LIMITS.maxFileBytes
    ),
    maxTotalBytes: normalizeLimit(
      optionObject.maxTotalBytes === undefined ? nested.maxTotalBytes : optionObject.maxTotalBytes,
      DEFAULT_LIMITS.maxTotalBytes
    ),
    maxLockfileBytes: normalizeLimit(
      optionObject.maxLockfileBytes === undefined ? nested.maxLockfileBytes : optionObject.maxLockfileBytes,
      DEFAULT_LIMITS.maxLockfileBytes
    ),
    maxEntries: normalizeLimit(
      optionObject.maxEntries === undefined ? nested.maxEntries : optionObject.maxEntries,
      DEFAULT_LIMITS.maxEntries
    )
  };
}

function toRelativePath(rootPath, absolutePath) {
  const relative = path.relative(rootPath, absolutePath) || '.';
  return relative.split(path.sep).join('/');
}

function rootName(rootPath) {
  const name = path.basename(rootPath);
  return name || '.';
}

function isSourcePath(relativePath) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isTestPath(relativePath) {
  if (!isSourcePath(relativePath)) return false;
  const normalized = relativePath.toLowerCase();
  const baseName = path.posix.basename(normalized);
  return /(^|\/)(test|tests|__tests__)(\/|$)/.test(normalized)
    || /(?:\.test|\.spec)\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(baseName);
}

function isRootPath(relativePath) {
  return !relativePath.includes('/');
}

function nestedPackagePaths(discovered) {
  return [...discovered.keys()]
    .filter((relativePath) => relativePath !== 'package.json' && /(^|\/)package\.json$/i.test(relativePath))
    .sort(compareStrings);
}

function isUnderNestedPackage(relativePath, nestedPaths) {
  return nestedPaths.some((packagePath) => {
    const directory = packagePath.slice(0, -'/package.json'.length);
    return relativePath === packagePath || relativePath.startsWith(`${directory}/`);
  });
}

function rootEcosystemMarker(discovered) {
  const rootFiles = new Set(sortedKnownRootFiles(discovered).map((relativePath) => relativePath.toLowerCase()));
  for (const marker of OTHER_ECOSYSTEM_MARKERS) {
    const match = marker.names.find((name) => rootFiles.has(name.toLowerCase()));
    if (match) return { path: match, ecosystem: marker.ecosystem };
  }
  const customMarker = sortedKnownRootFiles(discovered).find((relativePath) => /\.(?:csproj|sln)$/i.test(relativePath));
  return customMarker ? { path: customMarker, ecosystem: 'C#/.NET' } : null;
}

function isApplicationSourcePath(relativePath, nestedPaths) {
  if (!isReadableSourcePath(relativePath) || isTestPath(relativePath) || isUnderNestedPackage(relativePath, nestedPaths)) return false;
  if (/\.d\.ts$/i.test(relativePath)) return false;
  if (!relativePath.includes('/')) return true;
  const firstDirectory = relativePath.split('/')[0].toLowerCase();
  return new Set(['src', 'lib', 'app', 'server', 'bin']).has(firstDirectory);
}

function makeEvidence(relativePath, detail, line) {
  const evidence = {
    path: relativePath,
    detail: detail || ''
  };
  if (Number.isInteger(line) && line > 0) {
    evidence.line = line;
  }
  return evidence;
}

function addFinding(findings, code, status, severity, title, message, evidence, recommendation) {
  findings.push({
    code,
    status,
    severity,
    title,
    message,
    evidence: Array.isArray(evidence) ? evidence : [],
    recommendation
  });
  return findings[findings.length - 1];
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function firstMatchLine(text, expression) {
  const flags = expression.flags.replace('g', '');
  const match = new RegExp(expression.source, flags).exec(text);
  return match ? lineNumberAt(text, match.index) : undefined;
}

function decodeText(bytes) {
  return bytes.toString('utf8');
}

function parseEnvTemplate(text) {
  const keys = new Map();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|$)/.exec(lines[index]);
    if (match && !keys.has(match[1])) {
      keys.set(match[1], index + 1);
    }
  }
  return keys;
}

function extractEnvironmentReferences(text, relativePath) {
  const matches = [];
  const directPatterns = [
    { expression: /\bprocess\.env(?:\?\.|\.)([A-Za-z_][A-Za-z0-9_]*)/g, group: 1 },
    { expression: /\bprocess\.env\s*\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g, group: 2 },
    { expression: /\bimport\.meta\.env(?:\?\.|\.)([A-Za-z_][A-Za-z0-9_]*)/g, group: 1 },
    { expression: /\bimport\.meta\.env\s*\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g, group: 2 }
  ];

  for (const pattern of directPatterns) {
    pattern.expression.lastIndex = 0;
    let match = pattern.expression.exec(text);
    while (match) {
      matches.push({ key: match[pattern.group], index: match.index });
      match = pattern.expression.exec(text);
    }
  }

  function splitDestructuringBody(body) {
    const entries = [];
    let start = 0;
    let quote = null;
    let escaped = false;
    let depth = 0;
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{' || character === '[' || character === '(') depth += 1;
      else if (character === '}' || character === ']' || character === ')') depth = Math.max(0, depth - 1);
      else if (character === ',' && depth === 0) {
        entries.push({ text: body.slice(start, index), start });
        start = index + 1;
      }
    }
    entries.push({ text: body.slice(start), start });
    return entries;
  }

  function matchingDestructuringBrace(start) {
    const limit = Math.min(text.length, start + 1 + 10000);
    const stack = ['{'];
    let quote = null;
    let escaped = false;
    let comment = null;

    for (let index = start + 1; index < limit; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (comment === 'line') {
        if (character === '\n' || character === '\r') comment = null;
        continue;
      }
      if (comment === 'block') {
        if (character === '*' && next === '/') {
          comment = null;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }

      if (character === '/' && next === '/') {
        comment = 'line';
        index += 1;
        continue;
      }
      if (character === '/' && next === '*') {
        comment = 'block';
        index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        escaped = false;
        continue;
      }

      if (character === '{' || character === '[' || character === '(') {
        stack.push(character);
        continue;
      }
      if (character === '}' || character === ']' || character === ')') {
        const expected = character === '}' ? '{' : character === ']' ? '[' : '(';
        if (stack.at(-1) !== expected) return null;
        stack.pop();
        if (stack.length === 0) return index;
      }
    }

    return null;
  }

  const destructuringStarts = /(?:\b(?:const|let|var)\s*|\(\s*)\{/g;
  let destructuringStart = destructuringStarts.exec(text);
  while (destructuringStart) {
    const openingBrace = destructuringStart.index + destructuringStart[0].length - 1;
    const closingBrace = matchingDestructuringBrace(openingBrace);
    if (closingBrace !== null) {
      const assignment = /^\s*=\s*(?:process\.env|import\.meta\.env)\b/.exec(text.slice(closingBrace + 1));
      if (assignment) {
        const body = text.slice(openingBrace + 1, closingBrace);
        for (const entry of splitDestructuringBody(body)) {
          const trimmed = entry.text.trim();
          if (!trimmed || trimmed.startsWith('...') || trimmed.startsWith('[')) continue;
          const keyMatch = /^(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\1|([A-Za-z_][A-Za-z0-9_]*))(?=\s*(?::|=|$))/.exec(trimmed);
          if (!keyMatch) continue;
          matches.push({
            key: keyMatch[2] || keyMatch[3],
            index: openingBrace + 1 + entry.start + entry.text.indexOf(trimmed)
          });
        }
      }
    }
    destructuringStart = destructuringStarts.exec(text);
  }

  matches.sort((left, right) => left.index - right.index || compareStrings(left.key, right.key));
  const references = new Map();
  for (const match of matches) {
    if (!references.has(match.key)) {
      references.set(match.key, makeEvidence(
        relativePath,
        `Source references environment key ${match.key}.`,
        lineNumberAt(text, match.index)
      ));
    }
  }
  return references;
}

function parsePackageManager(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:@(.+))?$/.exec(text);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    version: match[2] || null
  };
}

function normalizeScripts(packageData) {
  if (!packageData || !packageData.scripts || typeof packageData.scripts !== 'object' || Array.isArray(packageData.scripts)) {
    return {};
  }

  const scripts = {};
  for (const name of Object.keys(packageData.scripts).sort(compareStrings)) {
    const value = packageData.scripts[name];
    Object.defineProperty(scripts, name, {
      value: typeof value === 'string' ? value : String(value),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return scripts;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const BROWSER_TEST_DEPENDENCIES = new Set([
  'karma',
  'puppeteer',
  'playwright',
  '@playwright/test',
  'cypress',
  '@web/test-runner',
  '@vitest/browser',
  '@vitest/browser-playwright'
]);
const BROWSER_TEST_RUNNERS = [
  'vitest',
  'karma',
  'cypress',
  'playwright',
  'puppeteer',
  'web-test-runner'
];

function dependencyMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).sort(compareStrings).map((name) => [name, String(value[name])]));
}

function dependencyEntries(packageData) {
  const entries = [];
  for (const field of DEPENDENCY_FIELDS) {
    const values = dependencyMap(packageData && packageData[field]);
    for (const name of Object.keys(values)) {
      entries.push({ field, name, specifier: values[name] });
    }
  }
  return entries;
}

function browserTestDependencyNames(packageData) {
  const devDependencies = dependencyMap(packageData && packageData.devDependencies);
  return Object.keys(devDependencies)
    .filter((name) => BROWSER_TEST_DEPENDENCIES.has(name.toLowerCase()))
    .sort(compareStrings);
}

function escapeRegexText(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function browserTestRunnerNames(command) {
  if (typeof command !== 'string') return [];
  return BROWSER_TEST_RUNNERS.filter((runner) => {
    const expression = new RegExp(
      `(?:^|[^A-Za-z0-9_@-])${escapeRegexText(runner)}(?=$|[^A-Za-z0-9_@-])`,
      'i'
    );
    return expression.test(command);
  });
}

function npmRunScriptNames(command) {
  if (typeof command !== 'string') return [];
  const names = [];
  const expression = /\bnpm\s+run\s+(?:--[^\s]+\s+)*([^\s"'`;&|]+)/gi;
  let match = expression.exec(command);
  while (match) {
    names.push(match[1]);
    match = expression.exec(command);
  }
  return names;
}

const TEST_LIFECYCLE_SCRIPT_NAMES = Object.freeze(['pretest', 'test', 'posttest']);
const GIT_METADATA_SCRIPT_REFERENCES = Object.freeze([
  { label: '.git', expression: /(?:^|[^A-Za-z0-9])\.git(?:$|[^A-Za-z0-9])/i },
  { label: 'git rev-parse', expression: /\bgit\b[^\r\n;&|]*\brev-parse\b/i },
  { label: 'git describe', expression: /\bgit\b[^\r\n;&|]*\bdescribe\b/i },
  { label: 'git ls-files', expression: /\bgit\b[^\r\n;&|]*\bls-files\b/i },
  { label: 'husky', expression: /\bhusky\b/i }
]);

function testLifecycleGitMetadataReferences(scripts, packageText) {
  const pending = [...TEST_LIFECYCLE_SCRIPT_NAMES];
  const visited = new Set();
  const references = [];

  while (pending.length > 0) {
    const scriptName = pending.shift();
    if (visited.has(scriptName) || !Object.prototype.hasOwnProperty.call(scripts, scriptName)) continue;
    visited.add(scriptName);
    const command = scripts[scriptName];
    const line = packageText
      ? firstMatchLine(packageText, new RegExp(`"${escapeRegexText(scriptName)}"\\s*:`))
      : undefined;

    for (const reference of GIT_METADATA_SCRIPT_REFERENCES) {
      if (!reference.expression.test(command)) continue;
      references.push({ scriptName, label: reference.label, line });
    }

    for (const referencedScript of npmRunScriptNames(command)) {
      if (!visited.has(referencedScript)) pending.push(referencedScript);
    }
  }

  return references.sort((left, right) => (
    compareStrings(left.scriptName, right.scriptName)
    || compareStrings(left.label, right.label)
  ));
}

function browserTestWorkflow(scripts) {
  const pending = ['test'];
  const visited = new Set();
  const runners = new Set();

  while (pending.length > 0) {
    const scriptName = pending.shift();
    if (visited.has(scriptName) || !Object.prototype.hasOwnProperty.call(scripts, scriptName)) continue;
    visited.add(scriptName);
    const command = scripts[scriptName];

    for (const runner of browserTestRunnerNames(command)) runners.add(runner);
    for (const referencedScript of npmRunScriptNames(command)) {
      if (!visited.has(referencedScript)) pending.push(referencedScript);
    }
  }

  return {
    runners: [...runners].sort(compareStrings),
    scriptNames: [...visited].sort(compareStrings)
  };
}

function parseReadableNpmLockfile(bytes) {
  try {
    const parsed = JSON.parse(decodeText(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!Number.isInteger(parsed.lockfileVersion)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function npmPackageName(packagePath, packageMetadata, packageData) {
  if (packageMetadata && typeof packageMetadata.name === 'string' && packageMetadata.name.trim()) {
    return packageMetadata.name.trim();
  }
  if (packagePath === '' && packageData && typeof packageData.name === 'string' && packageData.name.trim()) {
    return packageData.name.trim();
  }
  if (typeof packagePath !== 'string') return null;
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const name = packagePath.slice(markerIndex + marker.length);
  return name || null;
}

function npmInstallScriptPackageNames(lockfileData, packageData) {
  if (
    !lockfileData
    || ![2, 3].includes(lockfileData.lockfileVersion)
    || !lockfileData.packages
    || typeof lockfileData.packages !== 'object'
    || Array.isArray(lockfileData.packages)
  ) {
    return [];
  }

  const names = [];
  for (const packagePath of Object.keys(lockfileData.packages).sort(compareStrings)) {
    const packageMetadata = lockfileData.packages[packagePath];
    if (
      !packageMetadata
      || typeof packageMetadata !== 'object'
      || Array.isArray(packageMetadata)
      || packageMetadata.hasInstallScript !== true
    ) {
      continue;
    }
    const name = npmPackageName(packagePath, packageMetadata, packageData);
    if (name) names.push(name);
  }

  return [...new Set(names)].sort(compareStrings);
}

function regexForPackageName(name) {
  return new RegExp(`"${String(name).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"\\s*:`);
}

function cappedNames(names) {
  const sortedNames = [...new Set(names)].sort(compareStrings);
  const visible = sortedNames.slice(0, 20);
  const remaining = sortedNames.length - visible.length;
  return remaining > 0
    ? `${visible.join(', ')} (and ${remaining} more)`
    : visible.join(', ');
}

function cappedDifferenceNames(differences) {
  return cappedNames(differences.map((item) => item.name));
}

function addInstallScriptsSkippedFinding(findings, lockfileName, lockfileData, packageData) {
  const packageNames = npmInstallScriptPackageNames(lockfileData, packageData);
  if (packageNames.length === 0) return;

  addFinding(
    findings,
    'INSTALL_SCRIPTS_SKIPPED',
    'skipped',
    'info',
    'npm install scripts will be skipped during Docker verification',
    `Affected packages: ${cappedNames(packageNames)}. CloneProof runs npm ci --ignore-scripts, so their lifecycle/install scripts will not run.`,
    [makeEvidence(lockfileName, `npm lockfile metadata marks ${packageNames.length} package${packageNames.length === 1 ? '' : 's'} with hasInstallScript:true.`)],
    'Review whether these packages need native builds or generated artifacts before relying on Docker verification.'
  );
}

function compareNpmLockfile(packageData, lockfileData) {
  const version = lockfileData.lockfileVersion;
  const differences = [];

  if (version === 2 || version === 3) {
    const root = lockfileData.packages && lockfileData.packages[''];
    if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
    for (const field of DEPENDENCY_FIELDS) {
      const packageValues = dependencyMap(packageData[field]);
      const lockValues = dependencyMap(root[field]);
      const names = [...new Set([...Object.keys(packageValues), ...Object.keys(lockValues)])].sort(compareStrings);
      for (const name of names) {
        if (!(name in packageValues)) {
          differences.push({ field, name, kind: 'extra', packageSpecifier: null, lockSpecifier: lockValues[name] });
        } else if (!(name in lockValues)) {
          differences.push({ field, name, kind: 'missing', packageSpecifier: packageValues[name], lockSpecifier: null });
        } else if (packageValues[name] !== lockValues[name]) {
          differences.push({ field, name, kind: 'specifier', packageSpecifier: packageValues[name], lockSpecifier: lockValues[name] });
        }
      }
    }
    return differences;
  }

  if (version === 1) {
    const lockDependencies = lockfileData.dependencies;
    if (!lockDependencies || typeof lockDependencies !== 'object' || Array.isArray(lockDependencies)) return [];
    for (const entry of dependencyEntries(packageData)) {
      if (!Object.prototype.hasOwnProperty.call(lockDependencies, entry.name)) {
        differences.push({
          field: entry.field,
          name: entry.name,
          kind: 'missing',
          packageSpecifier: entry.specifier,
          lockSpecifier: null
        });
      }
    }
  }

  return differences;
}

function addLockfileSyncFinding(findings, packageText, lockfileName, lockfileBytes, packageData) {
  const lockfileData = parseReadableNpmLockfile(lockfileBytes);
  if (!lockfileData) return;
  const differences = compareNpmLockfile(packageData, lockfileData);
  if (differences.length === 0) return;

  const details = differences.map((difference) => {
    if (difference.kind === 'missing') return `${difference.name} missing from lockfile`;
    if (difference.kind === 'extra') return `${difference.name} extra in lockfile`;
    return `${difference.name} specifier differs (${difference.packageSpecifier} vs ${difference.lockSpecifier})`;
  });
  const evidence = [];
  for (const name of [...new Set(differences.map((difference) => difference.name))].sort(compareStrings).slice(0, 20)) {
    const line = firstMatchLine(packageText, regexForPackageName(name));
    evidence.push(makeEvidence('package.json', `Dependency ${name} is declared in package.json.`, line));
    evidence.push(makeEvidence(lockfileName, `Dependency ${name} differs from package.json.`));
  }

  addFinding(
    findings,
    'LOCKFILE_OUT_OF_SYNC',
    'failed',
    'error',
    'The npm lockfile is out of sync with package.json',
    `Dependency differences: ${cappedDifferenceNames(differences)}. Details: ${details.slice(0, 20).join('; ')}${details.length > 20 ? ` (and ${details.length - 20} more)` : ''}.`,
    evidence,
    'Run npm install locally and commit the updated lockfile.'
  );
}

function npmLockfileSummary(lockfiles, files) {
  const lockfile = lockfiles.find((candidate) => candidate.packageManager === 'npm' && files.has(candidate.name));
  if (!lockfile) return null;
  const parsed = parseReadableNpmLockfile(files.get(lockfile.name));
  if (!parsed || ![1, 2, 3].includes(parsed.lockfileVersion)) return null;
  let externalPackageCount = 0;
  if (parsed.lockfileVersion === 1) {
    const countDependencies = (dependencies) => {
      if (!dependencies || typeof dependencies !== 'object') return 0;
      return Object.values(dependencies).reduce((count, dependency) => (
        count + 1 + countDependencies(dependency && dependency.dependencies)
      ), 0);
    };
    externalPackageCount = countDependencies(parsed.dependencies);
  } else if (parsed.packages && typeof parsed.packages === 'object') {
    externalPackageCount = Object.entries(parsed.packages)
      .filter(([packagePath, value]) => packagePath !== '' && !(value && value.link === true))
      .length;
  }
  return {
    path: lockfile.name,
    lockfileVersion: parsed.lockfileVersion,
    externalPackageCount
  };
}

function parseDependencyUrlHost(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/^['"]|['"]$/g, '');
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    const fallback = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#\s]+@)?(\[[^\]]+\]|[^/?#:\s]+)(?::(\d+))?/i.exec(text);
    if (!fallback) return null;
    const hostname = fallback[1].toLowerCase();
    return {
      host: `${hostname}${fallback[2] ? `:${fallback[2]}` : ''}`,
      hostname: hostname.replace(/^\[|\]$/g, '')
    };
  }

  if (!parsed.hostname) return null;
  return {
    host: parsed.host.toLowerCase(),
    hostname: parsed.hostname.toLowerCase()
  };
}

function collectPrivateRegistryHosts(files, lockfiles, packageData) {
  const privateHosts = new Set();
  const privateEvidence = new Map();
  const gitHosts = new Set();
  const gitEvidence = new Map();
  let gitUsesSsh = false;

  function recordEvidence(collection, value, relativePath, detail, line) {
    collection.hosts.add(value);
    const key = `${relativePath}:${line || ''}:${detail}`;
    if (!collection.evidence.has(key)) collection.evidence.set(key, makeEvidence(relativePath, detail, line));
  }

  function recordPrivate(value, relativePath, detail, line) {
    const parsed = parseDependencyUrlHost(value);
    if (!parsed || PUBLIC_REGISTRY_HOSTNAMES.has(parsed.hostname) || PUBLIC_GIT_HOSTNAMES.has(parsed.hostname)) return;
    recordEvidence({ hosts: privateHosts, evidence: privateEvidence }, parsed.host, relativePath, detail, line);
  }

  function recordGit(value, relativePath, detail, line) {
    const text = typeof value === 'string' ? value.trim() : '';
    let host = null;
    let ssh = false;
    if (/^(?:github|gitlab|bitbucket):/i.test(text)) {
      const provider = text.slice(0, text.indexOf(':')).toLowerCase();
      host = provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org';
    } else if (/^[^@/\s]+\/[^/\s]+(?:#.*)?$/.test(text) && !text.startsWith('@')) {
      host = 'github.com';
    } else {
      const parsed = parseDependencyUrlHost(text);
      if (!parsed || !PUBLIC_GIT_HOSTNAMES.has(parsed.hostname)) return;
      host = parsed.host;
      ssh = /^git\+ssh:/i.test(text);
    }
    recordEvidence({ hosts: gitHosts, evidence: gitEvidence }, host, relativePath, detail, line);
    gitUsesSsh = gitUsesSsh || ssh;
  }

  if (files.has('.npmrc')) {
    const npmrc = decodeText(files.get('.npmrc'));
    const lines = npmrc.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\s*(?:@[^:\s=]+:)?registry\s*=\s*(.*?)(?:\s+#.*)?$/i.exec(lines[index]);
      if (!match) continue;
      recordPrivate(
        match[1],
        '.npmrc',
        'A registry setting references a non-public host.',
        index + 1
      );
    }
  }

  for (const lockfile of lockfiles.filter((candidate) => candidate.packageManager === 'npm')) {
    if (!files.has(lockfile.name)) continue;
    const parsed = parseReadableNpmLockfile(files.get(lockfile.name));
    if (!parsed) continue;

    function visit(value) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'resolved' && typeof child === 'string') {
          const parsed = parseDependencyUrlHost(child);
          if (parsed && PUBLIC_GIT_HOSTNAMES.has(parsed.hostname)) {
            recordGit(child, lockfile.name, 'An npm lockfile resolved URL references a public Git host.');
          } else {
            recordPrivate(child, lockfile.name, 'An npm lockfile resolved URL references a non-public host.');
          }
        }
        visit(child);
      }
    }

    visit(parsed);
  }

  for (const entry of dependencyEntries(packageData)) {
    const specifier = entry.specifier;
    const isShorthand = /^(?:github|gitlab|bitbucket):/i.test(specifier)
      || (/^[^@/\s]+\/[^/\s]+(?:#.*)?$/.test(specifier) && !specifier.startsWith('@'));
    if (!/^git\+(?:ssh|https):/i.test(specifier) && !isShorthand) continue;
    const parsed = parseDependencyUrlHost(specifier);
    const isPublicGit = isShorthand
      || (parsed && PUBLIC_GIT_HOSTNAMES.has(parsed.hostname));
    if (isPublicGit) {
      recordGit(specifier, 'package.json', 'A package dependency references a public Git host.');
    } else {
      recordPrivate(specifier, 'package.json', 'A Git dependency URL references a non-public host.');
    }
  }

  return {
    hosts: [...privateHosts].sort(compareStrings),
    evidence: [...privateEvidence.values()].sort((left, right) => (
      compareStrings(left.path, right.path)
      || (left.line || 0) - (right.line || 0)
      || compareStrings(left.detail, right.detail)
    )),
    gitHosts: [...gitHosts].sort(compareStrings),
    gitEvidence: [...gitEvidence.values()].sort((left, right) => (
      compareStrings(left.path, right.path)
      || (left.line || 0) - (right.line || 0)
      || compareStrings(left.detail, right.detail)
    )),
    gitUsesSsh
  };
}

function cappedHosts(hosts) {
  const visible = hosts.slice(0, 10);
  const remaining = hosts.length - visible.length;
  return remaining > 0
    ? `${visible.join(', ')} (and ${remaining} more)`
    : visible.join(', ');
}

function normalizePackageOutputPath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || raw.startsWith('#') || raw.includes(':')) return null;
  if (/[*?\[\]]/.test(raw)) return null;

  const withoutPrefix = raw.replace(/^\.\//, '');
  const normalized = path.posix.normalize(withoutPrefix);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function packageOutputPaths(packageData) {
  const paths = new Set();
  const add = (value) => {
    const normalized = normalizePackageOutputPath(value);
    if (normalized) paths.add(normalized);
  };

  add(packageData && packageData.main);
  add(packageData && packageData.types);

  const bin = packageData && packageData.bin;
  if (typeof bin === 'string') add(bin);
  else if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    for (const value of Object.values(bin)) add(value);
  }

  function visitExports(value) {
    if (typeof value === 'string') {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visitExports(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) visitExports(child);
  }

  visitExports(packageData && packageData.exports);
  return [...paths].sort(compareStrings);
}

function repositoryFileExists(rootPath, relativePath) {
  const segments = String(relativePath).split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return false;

  let current = path.resolve(rootPath);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink()) return false;
    if (index < segments.length - 1 && !stat.isDirectory()) return false;
    if (index === segments.length - 1) return stat.isFile();
  }
  return false;
}

function packageBuildOutputFinding(rootPath, scanned, packageData, scripts, readmeState, readmeText) {
  if (!packageData || typeof scripts.build !== 'string' || !scripts.build.trim()) return null;
  if (readmeState === 'unscanned' || readmeState === 'skipped') return null;
  if (readmeState === 'scanned' && /\bnpm\s+run(?:-script)?\s+build(?:\s|$|[`'"),.;!?])/i.test(readmeText)) return null;

  const missingPaths = packageOutputPaths(packageData)
    .filter((relativePath) => !scanned.discovered.has(relativePath) && !repositoryFileExists(rootPath, relativePath));
  if (missingPaths.length === 0) return null;

  return {
    missingPaths,
    message: `Build-related package metadata points to missing file${missingPaths.length === 1 ? '' : 's'}: ${missingPaths.join(', ')}.`,
    evidence: [
      makeEvidence('package.json', 'main, bin, exports, or types references a file outside the repository.'),
      ...missingPaths.map((relativePath) => makeEvidence(relativePath, 'Referenced build output file was not found.'))
    ]
  };
}

function likelyServiceReferences(scanned, packageData) {
  const references = [];
  const composePath = findRootFile(['docker-compose.yml', 'compose.yaml'], scanned.discovered);
  if (composePath) {
    references.push({
      label: composePath,
      evidence: makeEvidence(composePath, 'Root compose configuration may define an external service.')
    });
  }

  const dependencyNames = [...new Set(dependencyEntries(packageData)
    .filter((entry) => LIKELY_SERVICE_DEPENDENCIES.has(entry.name.toLowerCase()))
    .map((entry) => entry.name))].sort(compareStrings);
  for (const name of dependencyNames) {
    references.push({
      label: name,
      evidence: makeEvidence('package.json', `Dependency ${name} commonly connects to an external service.`)
    });
  }

  return references.sort((left, right) => compareStrings(left.label, right.label));
}

function firstNonEmptyLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (value && !value.startsWith('#')) return value;
  }
  return null;
}

function extractDockerNodeVersions(text) {
  const versions = new Set();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*FROM\s+(?:(?:--platform=[^\s]+)\s+)?([^\s]+)(?:\s+AS\s+[^\s]+)?(?:\s+#.*)?\s*$/i.exec(line);
    if (!match) continue;

    let image = match[1];
    image = image.split('@')[0];
    const slashIndex = image.lastIndexOf('/');
    const imageName = slashIndex === -1 ? image : image.slice(slashIndex + 1);
    if (!/^node(?::|$)/i.test(imageName)) continue;

    const colonIndex = imageName.indexOf(':');
    const tag = colonIndex === -1 ? 'latest' : imageName.slice(colonIndex + 1);
    if (!tag) continue;
    const versionMatch = /^(\d+(?:\.\d+){0,2})/.exec(tag);
    versions.add(versionMatch ? versionMatch[1] : tag);
  }
  return [...versions].sort(compareStrings);
}

function exactRuntimeVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*v?(\d+\.\d+\.\d+)\s*$/.exec(value);
  return match ? match[1] : null;
}

function parseVersionParts(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*v?(\d+)(?:\.(\d+|x|X))?(?:\.(\d+|x|X))?/ .exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] && !/^x$/i.test(match[2]) ? Number(match[2]) : null,
    patch: match[3] && !/^x$/i.test(match[3]) ? Number(match[3]) : null,
    full: Boolean(match[2] && match[3] && !/^x$/i.test(match[2]) && !/^x$/i.test(match[3]))
  };
}

function parsePinnedRuntime(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /^(?:lts(?:\/.*)?|node|latest|current|stable)$/i.test(raw)) return null;
  const parts = parseVersionParts(raw.replace(/[-+].*$/, ''));
  if (!parts) return null;
  return { raw, major: parts.major, minor: parts.minor, patch: parts.patch, full: parts.full };
}

function parseDockerNodeDeclarations(text, relativePath) {
  const declarations = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*FROM\s+(?:(?:--platform=[^\s]+)\s+)?([^\s]+)(?:\s+AS\s+[^\s]+)?(?:\s+#.*)?\s*$/i.exec(line);
    if (!match) continue;
    let image = match[1].split('@')[0];
    const slashIndex = image.lastIndexOf('/');
    const imageName = slashIndex === -1 ? image : image.slice(slashIndex + 1);
    if (!/^node(?::|$)/i.test(imageName)) continue;
    const colonIndex = imageName.indexOf(':');
    const tag = colonIndex === -1 ? 'latest' : imageName.slice(colonIndex + 1);
    const parsed = parsePinnedRuntime(tag);
    if (parsed) {
      const normalizedRaw = parsed.full
        ? `${parsed.major}.${parsed.minor}.${parsed.patch}`
        : parsed.minor !== null
          ? `${parsed.major}.${parsed.minor}`
          : String(parsed.major);
      declarations.push({
        ...parsed,
        raw: normalizedRaw,
        tag,
        path: relativePath,
        detail: 'Node base image declaration.'
      });
    }
  }
  return declarations;
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    const leftValue = left[key] ?? 0;
    const rightValue = right[key] ?? 0;
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function parseRangeVersion(value) {
  const parsed = parseVersionParts(value);
  if (!parsed) return null;
  return {
    major: parsed.major,
    minor: parsed.minor ?? 0,
    patch: parsed.patch ?? 0,
    full: parsed.full,
    minorSpecified: parsed.minor !== null,
    patchSpecified: parsed.patch !== null
  };
}

function comparePinnedPrefixToVersion(pinned, version) {
  for (const key of ['major', 'minor', 'patch']) {
    if (pinned[key] === null || pinned[key] === undefined) return 0;
    const pinnedValue = pinned[key];
    const versionValue = version[key] ?? 0;
    if (pinnedValue !== versionValue) return pinnedValue < versionValue ? -1 : 1;
  }
  return 0;
}

function partialPinCanBeAtLeast(pinned, version) {
  return comparePinnedPrefixToVersion(pinned, version) >= 0;
}

function partialPinCanBeGreaterThan(pinned, version) {
  return comparePinnedPrefixToVersion(pinned, version) >= 0;
}

function partialPinCanBeAtMost(pinned, version) {
  return comparePinnedPrefixToVersion(pinned, version) <= 0;
}

function partialPinCanBeLessThan(pinned, version) {
  const comparison = comparePinnedPrefixToVersion(pinned, version);
  if (comparison < 0) return true;
  if (comparison > 0) return false;
  if (pinned.minor === null || pinned.minor === undefined) {
    return (version.minor ?? 0) > 0 || (version.patch ?? 0) > 0;
  }
  if (pinned.patch === null || pinned.patch === undefined) {
    return (version.patch ?? 0) > 0;
  }
  return false;
}

function partialPinMatches(pinned, version) {
  return comparePinnedPrefixToVersion(pinned, version) === 0;
}

function satisfiesRangeToken(pinned, token) {
  const trimmed = token.trim();
  if (!trimmed) return true;
  const operatorMatch = /^(\^|~|>=|<=|>|<)?\s*(v?\d+(?:\.(?:\d+|x|X))?(?:\.(?:\d+|x|X))?)$/.exec(trimmed);
  if (!operatorMatch) return null;
  const operator = operatorMatch[1] || '';
  const version = parseRangeVersion(operatorMatch[2]);
  if (!version) return null;
  const pinnedVersion = {
    major: pinned.major,
    minor: pinned.minor ?? 0,
    patch: pinned.patch ?? 0
  };

  if (operator === '>' && !version.full) {
    const nextRelease = version.minorSpecified
      ? { major: version.major, minor: version.minor + 1, patch: 0 }
      : { major: version.major + 1, minor: 0, patch: 0 };
    return pinned.full
      ? compareVersions(pinnedVersion, nextRelease) >= 0
      : partialPinCanBeAtLeast(pinned, nextRelease);
  }

  if (!pinned.full) {
    if (operator === '^' && version.major === 0) {
      const lower = compareVersions(pinnedVersion, version) >= 0;
      const upper = pinned.major === 0 && pinned.minor === version.minor;
      return lower && upper;
    }
    if (operator === '^') {
      const upper = { major: version.major + 1, minor: 0, patch: 0 };
      return partialPinCanBeAtLeast(pinned, version) && partialPinCanBeLessThan(pinned, upper);
    }
    if (operator === '~') {
      const upper = version.minor > 0
        ? { major: version.major, minor: version.minor + 1, patch: 0 }
        : { major: version.major + 1, minor: 0, patch: 0 };
      return partialPinCanBeAtLeast(pinned, version) && partialPinCanBeLessThan(pinned, upper);
    }
    if (operator === '>=') return partialPinCanBeAtLeast(pinned, version);
    if (operator === '>') return partialPinCanBeGreaterThan(pinned, version);
    if (operator === '<=') return partialPinCanBeAtMost(pinned, version);
    if (operator === '<') return partialPinCanBeLessThan(pinned, version);
    return partialPinMatches(pinned, version);
  }

  if (operator === '^') {
    const lower = compareVersions(pinnedVersion, version) >= 0;
    const upper = version.major > 0
      ? pinnedVersion.major < version.major + 1
      : pinnedVersion.major === 0 && pinnedVersion.minor === version.minor;
    return lower && upper;
  }
  if (operator === '~') {
    const lower = compareVersions(pinnedVersion, version) >= 0;
    const upper = version.minor > 0
      ? (pinnedVersion.major === version.major && pinnedVersion.minor < version.minor + 1)
      : pinnedVersion.major < version.major + 1;
    return lower && upper;
  }
  if (operator === '>=') return compareVersions(pinnedVersion, version) >= 0;
  if (operator === '>') return compareVersions(pinnedVersion, version) > 0;
  if (operator === '<=') return compareVersions(pinnedVersion, version) <= 0;
  if (operator === '<') return compareVersions(pinnedVersion, version) < 0;
  if (version.full) return compareVersions(pinnedVersion, version) === 0;
  return pinned.major === version.major;
}

function satisfiesEngineRange(pinned, range) {
  if (typeof range !== 'string' || !range.trim()) return null;
  const alternatives = range.split('||').map((part) => part.trim());
  const results = [];
  for (const alternative of alternatives) {
    const tokens = alternative.split(/\s+/).filter(Boolean);
    const tokenResults = tokens.map((token) => satisfiesRangeToken(pinned, token));
    if (tokenResults.some((result) => result === null)) continue;
    results.push(tokenResults.every(Boolean));
  }
  return results.length > 0 ? results.some(Boolean) : null;
}

function stripReadmeCommandPunctuation(value) {
  return String(value)
    .trim()
    .replace(/^[`'"([{]+/, '')
    .replace(/[`'"\])},.;:!?]+$/, '')
    .trim();
}

function hasOnlyCommandFlags(value) {
  const normalized = stripReadmeCommandPunctuation(value);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.every((token) => token.startsWith('-'));
}

function setupCommandFromReadmeLine(line) {
  let value = String(line).trim();
  value = value.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
  value = value.replace(/^(?:[$>]\s*)/, '');
  value = value.replace(/\s+#.*$/, '');
  value = stripReadmeCommandPunctuation(value);
  if (!value || value.startsWith('```')) return null;

  const match = /^(npm\s+ci|yarn(?:\s+install)?|pnpm\s+(?:install|i))(?:\s+(.*))?$/i.exec(value);
  if (!match || !hasOnlyCommandFlags(match[2] || '')) return null;

  const command = match[1].toLowerCase();
  return {
    manager: command.startsWith('npm') ? 'npm' : command.startsWith('yarn') ? 'yarn' : 'pnpm',
    line,
    command: match[0]
  };
}

function readmeCdTarget(line) {
  const match = /(?:^|[;&|]\s*|\s)cd(?:\s+--)?\s+([^\s;&|`'"<>]+)/i.exec(String(line));
  if (!match) return null;
  return stripReadmeCommandPunctuation(match[1]).replace(/[\\/]+$/, '') || '.';
}

function readmePackageName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@[^/]+\//, '');
  return normalized || null;
}

function parseReadmeCommands(text, options = {}) {
  const references = new Map();
  const setupCommands = [];
  const otherProjectLines = [];
  const lines = text.split(/\r?\n/);
  const ownProjectNames = new Set([
    readmePackageName(options.repositoryName),
    readmePackageName(options.rootName),
    readmePackageName(options.packageName),
    readmePackageName(options.packageName && String(options.packageName).split('/').pop())
  ].filter(Boolean).map((name) => name.toLowerCase()));
  let differentProject = false;

  function addOtherProjectLine(lineNumber, line) {
    if (otherProjectLines.length >= 10) return;
    const textValue = String(line).trim();
    if (!textValue || otherProjectLines.some((entry) => entry.line === lineNumber)) return;
    otherProjectLines.push({ line: lineNumber, text: textValue });
  }

  function addReference(key, kind, line, detail) {
    if (!references.has(key)) {
      references.set(key, { kind, line, detail, scriptName: null });
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    if (/^\s*#{1,6}(?:\s|$)/.test(line)) differentProject = false;
    const cdTarget = readmeCdTarget(line);
    if (cdTarget) {
      const normalizedTarget = cdTarget.toLowerCase();
      const isRepositoryTarget = cdTarget === '.'
        || cdTarget === './'
        || ownProjectNames.has(normalizedTarget)
        || normalizedTarget === (options.packageName || '').toLowerCase();
      if (!isRepositoryTarget) {
        differentProject = true;
        addOtherProjectLine(lineNumber, line);
      }
    }
    if (differentProject) {
      if (/\b(?:npm|yarn|pnpm)\s+\S+/i.test(line)) addOtherProjectLine(lineNumber, line);
      continue;
    }

    const setupCommand = setupCommandFromReadmeLine(line);
    if (setupCommand) setupCommands.push({ ...setupCommand, line: lineNumber });

    if (/\bnpm\s+test(?=$|[\s`'"),.;:!?])/i.test(line)) {
      addReference('test', 'test', lineNumber, 'README references npm test.');
    }

    const installExpression = /\bnpm\s+(ci|install|i)(?=$|[\s`'"),.;:!?])/gi;
    let installMatch = installExpression.exec(line);
    while (installMatch) {
      const kind = installMatch[1].toLowerCase();
      const suffix = line.slice(installMatch.index + installMatch[0].length);
      if (kind !== 'i' || hasOnlyCommandFlags(suffix)) {
        const normalizedKind = kind === 'i' ? 'install' : kind;
        addReference(normalizedKind, normalizedKind, lineNumber, `README references npm ${normalizedKind}.`);
      }
      installMatch = installExpression.exec(line);
    }

    const startExpression = /\bnpm\s+start(?=$|[\s`'"),.;:!?])/gi;
    let startMatch = startExpression.exec(line);
    while (startMatch) {
      addReference('start', 'start', lineNumber, 'README references npm start.');
      startMatch = startExpression.exec(line);
    }

    const runExpression = /\b(npm|yarn|pnpm)\s+(run-script|run)\s+([^\s`'"<>]+)/gi;
    let runMatch = runExpression.exec(line);
    while (runMatch) {
      const manager = runMatch[1].toLowerCase();
      const verb = runMatch[2].toLowerCase();
      const scriptName = runMatch[3].replace(/[),.;:!?]+$/g, '');
      if (scriptName && !scriptName.startsWith('<')) {
        addReference(`run:${scriptName}`, 'run', lineNumber, `README references ${manager} ${verb} ${scriptName}.`);
        references.get(`run:${scriptName}`).scriptName = scriptName;
      }
      runMatch = runExpression.exec(line);
    }
  }

  return {
    references: [...references.values()],
    setupCommands,
    otherProjectLines
  };
}

function isCoreFile(relativePath) {
  if (relativePath.includes('/')) return false;
  const lower = relativePath.toLowerCase();
  return lower === 'package.json'
    || lower === 'package-lock.json'
    || lower === 'npm-shrinkwrap.json'
    || lower === 'pnpm-lock.yaml'
    || lower === 'yarn.lock'
    || lower === '.npmrc'
    || lower === 'readme'
    || lower === 'readme.md'
    || lower === 'readme.markdown'
    || lower === '.nvmrc'
    || lower === '.node-version'
    || lower === '.env.example'
    || lower === '.env.sample'
    || lower === 'tsconfig.json'
    || /^dockerfile(?:\..*)?$/.test(lower);
}

function classifyLstatFailure(relativePath, entry) {
  return entry && typeof entry.isFile === 'function' && entry.isFile() && isCoreFile(relativePath)
    ? 'error'
    : 'skip';
}

function escapeRegexCharacter(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function globSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        while (pattern[index + 1] === '*') index += 1;
        if (pattern[index + 1] === '/') {
          source += '(?:.*/)?';
          index += 1;
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    if (character === '[') {
      let end = index + 1;
      if (pattern[end] === '!' || pattern[end] === '^') end += 1;
      if (pattern[end] === ']') end += 1;
      while (end < pattern.length && pattern[end] !== ']') end += 1;
      if (end < pattern.length) {
        let body = pattern.slice(index + 1, end);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        body = body.replace(/\\/g, '\\\\').replace(/\//g, '\\/');
        source += `[${body}]`;
        index = end;
        continue;
      }
    }
    source += escapeRegexCharacter(character);
  }
  return source;
}

function parseGitignorePattern(line) {
  let value = line.trim();
  if (!value) return null;

  let escapedCommentOrNegation = false;
  if (value.startsWith('\\#') || value.startsWith('\\!')) {
    value = value.slice(1);
    escapedCommentOrNegation = true;
  } else if (value.startsWith('#')) {
    return null;
  }

  let negated = false;
  if (!escapedCommentOrNegation && value.startsWith('!')) {
    negated = true;
    value = value.slice(1);
  }

  const anchored = value.startsWith('/');
  if (anchored) value = value.slice(1);
  const directoryOnly = value.endsWith('/');
  if (directoryOnly) value = value.slice(0, -1);
  if (!value) return null;

  const hasSlash = value.includes('/');
  const source = globSource(value);
  const prefix = anchored || hasSlash ? '' : '(?:.*/)?';
  return {
    negated,
    directoryOnly,
    expression: new RegExp(`^${prefix}${source}$`)
  };
}

function createGitignoreMatcher(texts) {
  const patterns = [];
  for (const text of texts) {
    for (const line of String(text).split(/\r?\n/)) {
      const pattern = parseGitignorePattern(line);
      if (pattern) patterns.push(pattern);
    }
  }

  return {
    isIgnored(relativePath, isDirectory) {
      let ignored = false;
      const normalized = relativePath.split(path.sep).join('/');
      for (const pattern of patterns) {
        if (pattern.directoryOnly && !isDirectory) continue;
        if (pattern.expression.test(normalized)) ignored = !pattern.negated;
      }
      return ignored;
    }
  };
}

function readRegularIgnoreFile(filePath, maximumBytes = 1024 * 1024) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximumBytes) return null;
  try {
    return decodeText(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

function loadGitignoreMatcher(rootPath, freshClone, symlinkPaths = new Set()) {
  if (freshClone) return null;
  const blockedPaths = new Set(
    [...(symlinkPaths instanceof Set
      ? symlinkPaths
      : Array.isArray(symlinkPaths) ? symlinkPaths : [])]
      .map((relativePath) => String(relativePath).split('\\').join('/'))
  );
  const texts = [];
  const rootGitignore = blockedPaths.has('.gitignore')
    ? null
    : readRegularIgnoreFile(path.join(rootPath, '.gitignore'));
  if (rootGitignore !== null) texts.push(rootGitignore);

  const gitDirectory = path.join(rootPath, '.git');
  let gitStat;
  try {
    gitStat = fs.lstatSync(gitDirectory);
  } catch {
    gitStat = null;
  }
  if (gitStat && gitStat.isDirectory() && !gitStat.isSymbolicLink()) {
    const exclude = readRegularIgnoreFile(path.join(gitDirectory, 'info', 'exclude'));
    if (exclude !== null) texts.push(exclude);
  }

  return createGitignoreMatcher(texts);
}

function isLockfilePath(relativePath) {
  const lower = relativePath.toLowerCase();
  return lower === 'package-lock.json'
    || lower === 'npm-shrinkwrap.json'
    || lower === 'pnpm-lock.yaml'
    || lower === 'yarn.lock';
}

function isReadableSourcePath(relativePath) {
  if (!isSourcePath(relativePath)) return false;
  const lower = relativePath.toLowerCase();
  return !lower.endsWith('.min.js') && !lower.endsWith('.bundle.js');
}

function scanFiles(rootPath, limits, options = {}) {
  const files = new Map();
  const discovered = new Map();
  const skipped = new Set();
  const ignoredCorePaths = new Set();
  const depthSkipped = new Set();
  const errors = [];
  let complete = true;
  let fileCount = 0;
  let totalBytes = 0;
  let discoveredFileCount = 0;
  let entryCount = 0;
  let skippedPathsTruncated = false;
  let rootState = 'ok';
  let entryLimitExceeded = false;
  let entryLimitPath = null;
  const gitSymlinkPaths = new Set(
    (Array.isArray(options.symlinkPaths) ? options.symlinkPaths : [])
      .map((relativePath) => String(relativePath).split('\\').join('/'))
      .filter((relativePath) => relativePath.length > 0)
  );

  function addSkipped(relativePath, makesIncomplete = false) {
    if (skipped.size < 500) skipped.add(relativePath || '.');
    else skippedPathsTruncated = true;
    if (makesIncomplete) complete = false;
  }

  function addError(relativePath, kind) {
    errors.push({ path: relativePath || '.', kind });
    complete = false;
  }

  function emptyResult() {
    return {
      files,
      discovered,
      skipped,
      ignoredCorePaths,
      depthSkipped,
      skippedPathsTruncated,
      errors,
      complete,
      fileCount,
      discoveredFileCount,
      totalBytes,
      rootState,
      entryLimitPath
    };
  }

  let rootStat;
  try {
    rootStat = fs.lstatSync(rootPath);
  } catch {
    rootState = 'unavailable';
    addError('.', 'root');
    return emptyResult();
  }

  if (rootStat.isSymbolicLink()) {
    rootState = 'symlink';
    addSkipped('.', true);
    return emptyResult();
  }

  if (!rootStat.isDirectory()) {
    rootState = 'not-directory';
    addError('.', 'root');
    return emptyResult();
  }

  const ignoreMatcher = loadGitignoreMatcher(rootPath, options.freshClone === true, gitSymlinkPaths);

  function visitDirectory(absoluteDirectory, relativeDirectory, depth, nestedPackageRoot = null) {
    if (entryLimitExceeded) return;
    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      addError(relativeDirectory, 'directory');
      return;
    }

    entries = [
      ...entries.filter((entry) => !entry.isDirectory()).sort((left, right) => compareStrings(left.name, right.name)),
      ...entries.filter((entry) => entry.isDirectory()).sort((left, right) => compareStrings(left.name, right.name))
    ];
    const hasNestedPackageManifest = relativeDirectory !== '.'
      && entries.some((entry) => entry.isFile()
        && !gitSymlinkPaths.has(toRelativePath(rootPath, path.join(absoluteDirectory, entry.name)))
        && entry.name.toLowerCase() === 'package.json');
    const activeNestedPackageRoot = nestedPackageRoot || (hasNestedPackageManifest ? relativeDirectory : null);

    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        complete = false;
        entryLimitExceeded = true;
        entryLimitPath = toRelativePath(rootPath, path.join(absoluteDirectory, entry.name));
        break;
      }

      const absoluteEntry = path.join(absoluteDirectory, entry.name);
      const relativeEntry = toRelativePath(rootPath, absoluteEntry);
      let entryStat;

      if (gitSymlinkPaths.has(relativeEntry)) {
        addSkipped(relativeEntry);
        continue;
      }

      try {
        entryStat = fs.lstatSync(absoluteEntry);
      } catch {
        if (classifyLstatFailure(relativeEntry, entry) === 'error') addError(relativeEntry, 'file');
        else addSkipped(relativeEntry);
        continue;
      }

      if (entryStat.isSymbolicLink()) {
        addSkipped(relativeEntry);
        continue;
      }

      if (entryStat.isDirectory()) {
        if (ignoreMatcher && ignoreMatcher.isIgnored(relativeEntry, true)) {
          addSkipped(relativeEntry);
          continue;
        }
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          addSkipped(relativeEntry);
          continue;
        }
        if (depth + 1 > limits.maxDepth) {
          depthSkipped.add(relativeEntry);
          addSkipped(relativeEntry);
          continue;
        }
        visitDirectory(absoluteEntry, relativeEntry, depth + 1, activeNestedPackageRoot);
        if (entryLimitExceeded) break;
        continue;
      }

      if (!entryStat.isFile()) continue;
      const nestedFile = Boolean(activeNestedPackageRoot);
      const coreFile = !nestedFile && isCoreFile(relativeEntry);
      if (ignoreMatcher && ignoreMatcher.isIgnored(relativeEntry, false) && !coreFile) {
        addSkipped(relativeEntry);
        continue;
      }
      if (
        ignoreMatcher
        && ignoreMatcher.isIgnored(relativeEntry, false)
        && coreFile
        && relativeEntry.toLowerCase() !== '.npmrc'
      ) {
        ignoredCorePaths.add(relativeEntry);
      }
      discoveredFileCount += 1;
      const metadata = { size: entryStat.size, category: 'stat' };
      discovered.set(relativeEntry, metadata);

      if (depth + 1 > limits.maxDepth) {
        addSkipped(relativeEntry);
        continue;
      }

      const sourceFile = !nestedFile && isReadableSourcePath(relativeEntry);
      if (!coreFile && !sourceFile) continue;
      metadata.category = coreFile ? 'core' : 'source';

      const sizeLimit = coreFile && isLockfilePath(relativeEntry)
        ? limits.maxLockfileBytes
        : limits.maxFileBytes;
      if (entryStat.size > sizeLimit) {
        addSkipped(relativeEntry, coreFile);
        continue;
      }
      if (fileCount >= limits.maxFiles || totalBytes + entryStat.size > limits.maxTotalBytes) {
        addSkipped(relativeEntry, coreFile);
        continue;
      }

      let bytes;
      try {
        bytes = fs.readFileSync(absoluteEntry);
      } catch {
        if (coreFile) addError(relativeEntry, 'file');
        else addSkipped(relativeEntry);
        continue;
      }

      const actualLimit = coreFile && isLockfilePath(relativeEntry)
        ? limits.maxLockfileBytes
        : limits.maxFileBytes;
      if (bytes.length > actualLimit || totalBytes + bytes.length > limits.maxTotalBytes) {
        addSkipped(relativeEntry, coreFile);
        continue;
      }

      files.set(relativeEntry, bytes);
      metadata.scanned = true;
      fileCount += 1;
      totalBytes += bytes.length;
    }
  }

  visitDirectory(rootPath, '.', 0);

  return emptyResult();
}

function stateFor(relativePath, files, discovered, skipped) {
  if (files.has(relativePath)) return 'scanned';
  if (discovered.has(relativePath)) return 'unscanned';
  if (skipped.has(relativePath)) return 'skipped';
  return 'absent';
}

function sortedKnownRootFiles(discovered) {
  return [...discovered.keys()]
    .filter((relativePath) => isRootPath(relativePath))
    .sort(compareStrings);
}

function findRootFile(names, discovered) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return sortedKnownRootFiles(discovered)
    .find((relativePath) => wanted.has(relativePath.toLowerCase())) || null;
}

function calculateDigest(files) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...files.keys()].sort(compareStrings)) {
    hash.update(relativePath, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(files.get(relativePath));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function normalizedAbsolutePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function wrongTargetReport(absoluteRoot, limits) {
  const findings = [
    addFinding(
      [],
      'WRONG_TARGET',
      'skipped',
      'warning',
      'The target is a home folder or filesystem root',
      'This is your home folder (or a drive root), not a project folder.',
      [makeEvidence(rootName(absoluteRoot), 'The requested local target is a home folder or filesystem root.')],
      'Run cloneproof check <project-folder> or cloneproof check https://github.com/OWNER/REPO.'
    )
  ];
  const coverage = createCoverageTracker().snapshot();
  return {
    schemaVersion: 2,
    tool: 'cloneproof',
    mode: 'check',
    status: 'blocked',
    target: { kind: 'local', name: rootName(absoluteRoot) },
    scan: {
      complete: false,
      fileCount: 0,
      discoveredFileCount: 0,
      totalBytes: 0,
      digest: calculateDigest(new Map()),
      limits,
      skippedPaths: [],
      skippedPathsTruncated: false
    },
    project: {
      type: 'unsupported',
      packageManager: null,
      packageManagerVersion: null,
      scripts: {},
      runtime: { nvmrc: null, nodeVersion: null, enginesNode: null, dockerNode: [] }
    },
    findings,
    summary: { total: 1, passed: 0, failed: 0, warnings: 1, skipped: 1 },
    coverage
  };
}

function inferProjectType(packageState, discovered, nestedPaths = [], ecosystemMarker = rootEcosystemMarker(discovered)) {
  const knownPaths = [...discovered.keys()].filter((relativePath) => isApplicationSourcePath(relativePath, nestedPaths));
  const hasRootTsconfig = discovered.has('tsconfig.json');
  const hasTypeScriptSource = knownPaths.some((relativePath) => /\.(?:ts|cts|mts|tsx)$/i.test(relativePath));
  const hasJavaScript = knownPaths.some((relativePath) => /\.(?:js|cjs|mjs|jsx)$/i.test(relativePath));

  if (packageState !== 'absent') return hasRootTsconfig || hasTypeScriptSource ? 'typescript' : 'node';
  if (ecosystemMarker) return 'unsupported';
  if (hasTypeScriptSource) return 'typescript';
  if (hasJavaScript) return 'node';
  return 'unsupported';
}

function scanRepository(rootPath, options) {
  let absoluteRoot;
  try {
    absoluteRoot = path.resolve(typeof rootPath === 'string' && rootPath ? rootPath : '.');
  } catch {
    absoluteRoot = path.resolve('.');
  }

  const limits = normalizeLimits(options);
  const scanOptions = options && typeof options === 'object' ? options : {};
  let homeDirectory;
  try {
    homeDirectory = normalizedAbsolutePath(scanOptions.homeDirectory === undefined ? os.homedir() : scanOptions.homeDirectory);
  } catch {
    homeDirectory = normalizedAbsolutePath(os.homedir());
  }
  const filesystemRoot = normalizedAbsolutePath(path.parse(absoluteRoot).root);
  if (normalizedAbsolutePath(absoluteRoot) === homeDirectory || normalizedAbsolutePath(absoluteRoot) === filesystemRoot) {
    return wrongTargetReport(absoluteRoot, limits);
  }
  const scanned = scanFiles(absoluteRoot, limits, scanOptions);
  const coverage = createCoverageTracker();
  const findings = [];
  const packageState = stateFor('package.json', scanned.files, scanned.discovered, scanned.skipped);
  const nestedPackageFiles = nestedPackagePaths(scanned.discovered);
  const ecosystemMarker = rootEcosystemMarker(scanned.discovered);
  const projectType = inferProjectType(packageState, scanned.discovered, nestedPackageFiles, ecosystemMarker);
  const supportedProject = projectType === 'node' || projectType === 'typescript';
  const packageText = packageState === 'scanned'
    ? decodeText(scanned.files.get('package.json'))
    : null;

  if (scanned.rootState === 'ok') {
    coverage.mark(CHECK_GROUPS.NESTED_PACKAGES);
    coverage.mark(CHECK_GROUPS.PROJECT_CLASSIFICATION);
  }
  if (scanned.rootState === 'ok' && supportedProject) {
    coverage.mark(CHECK_GROUPS.PACKAGE_MANIFEST);
    coverage.mark(CHECK_GROUPS.LOCKFILE);
    coverage.mark(CHECK_GROUPS.TEST_SCRIPT);
    coverage.mark(CHECK_GROUPS.NODE_RUNTIME);
    if (scanOptions.freshClone !== true) {
      coverage.mark(CHECK_GROUPS.GITIGNORED_CORE_FILES);
    }
  }

  let packageData = null;
  let packageValid = false;
  if (packageState === 'scanned') {
    try {
      const parsed = JSON.parse(packageText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest is not an object');
      packageData = parsed;
      packageValid = true;
    } catch {
      addFinding(
        findings,
        'PACKAGE_JSON_INVALID',
        'failed',
        'error',
        'Root package.json is malformed',
        'The root package manifest could not be parsed as a JSON object.',
        [makeEvidence('package.json', 'The root package manifest is not valid JSON.')],
        'Fix package.json so it is valid JSON before relying on package metadata.'
      );
    }
  }

  const declaredPackageManager = packageValid ? parsePackageManager(packageData.packageManager) : null;
  let packageManagerInfo = declaredPackageManager;
  const lockfiles = LOCKFILES.filter((lockfile) => scanned.discovered.has(lockfile.name));
  if (!packageManagerInfo && lockfiles.length > 0) {
    const selectedLockfile = lockfiles[0];
    packageManagerInfo = { name: selectedLockfile.packageManager, version: null };
  }

  if (declaredPackageManager && lockfiles.length > 0) {
    if (supportedProject && scanned.rootState === 'ok') {
      coverage.mark(CHECK_GROUPS.PACKAGE_MANAGER);
    }
    const lockfileManagers = [...new Set(lockfiles.map((lockfile) => lockfile.packageManager))].sort(compareStrings);
    if (!lockfileManagers.includes(declaredPackageManager.name)) {
      addFinding(
        findings,
        'PACKAGE_MANAGER_LOCKFILE_MISMATCH',
        'failed',
        'error',
        'The declared package manager does not match the lockfile',
        `package.json declares ${declaredPackageManager.name}, but the root lockfile${lockfiles.length === 1 ? '' : 's'} indicate${lockfiles.length === 1 ? 's' : ''} ${lockfileManagers.join(', ')}.`,
        [
          makeEvidence('package.json', `packageManager declares ${declaredPackageManager.name}.`),
          ...lockfiles.map((lockfile) => makeEvidence(lockfile.name, `Lockfile belongs to ${lockfile.packageManager}.`))
        ],
        'Use the lockfile for the declared package manager or update package.json to match the authoritative lockfile.'
      );
    }
  }

  const scripts = packageValid ? normalizeScripts(packageData) : {};
  const enginesNode = packageValid
    && packageData.engines
    && typeof packageData.engines === 'object'
    && typeof packageData.engines.node === 'string'
    ? packageData.engines.node
    : null;

  const nvmrcState = stateFor('.nvmrc', scanned.files, scanned.discovered, scanned.skipped);
  const nvmrc = nvmrcState === 'scanned'
    ? firstNonEmptyLine(decodeText(scanned.files.get('.nvmrc')))
    : null;
  const nodeVersionState = stateFor('.node-version', scanned.files, scanned.discovered, scanned.skipped);
  const nodeVersion = nodeVersionState === 'scanned'
    ? firstNonEmptyLine(decodeText(scanned.files.get('.node-version')))
    : null;

  const dockerFiles = sortedKnownRootFiles(scanned.discovered)
    .filter((relativePath) => /^dockerfile(?:\..*)?$/i.test(relativePath));
  const dockerDeclarations = [];
  const unscannedDockerFiles = [];
  for (const dockerFile of dockerFiles) {
    if (scanned.files.has(dockerFile)) {
      dockerDeclarations.push(...parseDockerNodeDeclarations(decodeText(scanned.files.get(dockerFile)), dockerFile));
    } else {
      unscannedDockerFiles.push(dockerFile);
    }
  }
  const dockerNode = [...new Set(dockerDeclarations.map((declaration) => declaration.raw))].sort(compareStrings);
  if (
    scanned.rootState === 'ok'
    && (
      nvmrcState !== 'absent'
      || nodeVersionState !== 'absent'
      || Boolean(enginesNode)
      || dockerFiles.length > 0
    )
  ) {
    coverage.mark(CHECK_GROUPS.NODE_RUNTIME);
  }

  const target = {
    kind: 'local',
    name: rootName(absoluteRoot)
  };

  const createReport = () => {
    const digest = calculateDigest(scanned.files);
    const lockfileSummary = npmLockfileSummary(lockfiles, scanned.files);
    const project = {
      type: projectType,
      packageManager: packageManagerInfo ? packageManagerInfo.name : null,
      packageManagerVersion: packageManagerInfo ? packageManagerInfo.version : null,
      ...(lockfileSummary ? { lockfile: lockfileSummary } : {}),
      scripts,
      runtime: {
        nvmrc,
        nodeVersion,
        enginesNode,
        dockerNode
      }
    };
    const summary = {
      total: findings.length,
      passed: findings.filter((finding) => finding.status === 'passed').length,
      failed: findings.filter((finding) => finding.status === 'failed').length,
      warnings: findings.filter((finding) => finding.status === 'warning').length,
      skipped: findings.filter((finding) => finding.status === 'skipped').length
    };
    let status = 'passed';
    if (!scanned.complete) status = 'incomplete';
    else if (projectType === 'unsupported') status = 'blocked';
    else if (summary.failed > 0) status = 'failed';
    else if (summary.warnings > 0) status = 'passed_with_warnings';

    return {
      schemaVersion: 2,
      tool: 'cloneproof',
      mode: 'check',
      status,
      target,
      scan: {
        complete: scanned.complete,
        fileCount: scanned.fileCount,
        discoveredFileCount: scanned.discoveredFileCount,
        totalBytes: scanned.totalBytes,
        digest,
        limits,
        skippedPaths: [...scanned.skipped].sort(compareStrings),
        skippedPathsTruncated: scanned.skippedPathsTruncated
      },
      project,
      findings,
      summary,
      coverage: coverage.snapshot()
    };
  };

  if (nestedPackageFiles.length > 0) {
    const visibleNestedPackages = nestedPackageFiles.slice(0, 50);
    const messagePaths = nestedPackageFiles.slice(0, 5);
    addFinding(
      findings,
      'NESTED_PACKAGES_SKIPPED',
      'skipped',
      'info',
      'Nested packages were excluded from the root application checks',
      `Found ${nestedPackageFiles.length} nested package manifest${nestedPackageFiles.length === 1 ? '' : 's'}; first ${messagePaths.length} path${messagePaths.length === 1 ? '' : 's'}: ${messagePaths.join(', ')}.`,
      visibleNestedPackages.map((relativePath) => makeEvidence(relativePath, 'Nested package boundary.')),
      'Run CloneProof separately on each nested package directory.'
    );
  }

  if (scanned.rootState !== 'ok') {
    addFinding(
      findings,
      'SCAN_ROOT_UNAVAILABLE',
      'failed',
      'error',
      'Repository root could not be inspected',
      'The requested local repository root is unavailable or is not a directory.',
      [makeEvidence('.', 'The repository root could not be read as a directory.')],
      'Provide an existing readable directory as the repository root.'
    );
  }

  if (scanned.entryLimitPath) {
    const formattedLimit = String(limits.maxEntries).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    addFinding(
      findings,
      'SCAN_ENTRY_LIMIT_EXCEEDED',
      'skipped',
      'warning',
      'The repository scan entry limit was exceeded',
      `Stopped after ${formattedLimit} directory entries; the folder is too large to inspect fully.`,
      [makeEvidence(scanned.entryLimitPath, 'The entry limit was exceeded while inspecting this path.')],
      'Point CloneProof at a single project folder.'
    );
  }

  for (const error of [...scanned.errors].sort((left, right) => {
    const pathOrder = compareStrings(left.path, right.path);
    return pathOrder || compareStrings(left.kind, right.kind);
  })) {
    if (error.path === '.' && error.kind === 'root') continue;
    const isDirectory = error.kind === 'directory';
    addFinding(
      findings,
      isDirectory ? 'SCAN_DIRECTORY_UNREADABLE' : 'SCAN_FILE_UNREADABLE',
      'failed',
      'error',
      isDirectory ? 'A repository directory could not be read' : 'A repository file could not be read',
      isDirectory
        ? 'A directory could not be read, so the bounded scan is incomplete.'
        : 'A file could not be read, so the bounded scan is incomplete.',
      [makeEvidence(error.path, isDirectory ? 'Directory read failed.' : 'File read failed.')],
      'Make the repository entry readable and run the scan again.'
    );
  }

  for (const relativePath of supportedProject
    ? [...scanned.ignoredCorePaths].sort(compareStrings)
    : []) {
    addFinding(
      findings,
      'CORE_FILE_GITIGNORED',
      'warning',
      'warning',
      'A core file matches a gitignore rule',
      `${relativePath} matches an ignore rule; unless it is already tracked, a fresh clone will not contain it.`,
      [makeEvidence(relativePath, 'Core file matches a local ignore rule.')],
      `Confirm with git ls-files ${relativePath}, or check the GitHub URL instead.`
    );
  }

  if (packageState === 'scanned' && packageValid) {
    addFinding(
      findings,
      'PACKAGE_JSON_PRESENT',
      'passed',
      'info',
      'Root package.json is readable',
      'The root package manifest was parsed successfully.',
      [makeEvidence('package.json', 'Root package manifest parsed successfully.')],
      'Keep package.json valid and checked into the repository.'
    );
  } else if (packageState === 'absent' && projectType !== 'unsupported' && scanned.rootState === 'ok') {
    addFinding(
      findings,
      'PACKAGE_JSON_MISSING',
      'failed',
      'error',
      'Root package.json is missing',
      'Node.js or TypeScript source was found, but no root package manifest was available.',
      [],
      'Add a root package.json describing the project and its scripts.'
    );
  } else if ((packageState === 'unscanned' || packageState === 'skipped') && scanned.rootState === 'ok') {
    addFinding(
      findings,
      'PACKAGE_JSON_UNSCANNED',
      'skipped',
      'info',
      'Root package.json could not be inspected',
      'The root package manifest was discovered but skipped by the scan bounds or file policy.',
      [makeEvidence('package.json', 'Package manifest was not included in the readable scan set.')],
      'Increase the scan bounds or make package.json readable, then run the scan again.'
    );
  }

  if (projectType === 'unsupported' && scanned.rootState === 'ok') {
    if (scanned.discoveredFileCount === 0 && scanned.complete && !ecosystemMarker) {
      addFinding(
        findings,
        'EMPTY_REPOSITORY',
        'warning',
        'warning',
        'The repository is empty',
        'No readable files were found in the repository root.',
        [],
        'Add the project files before asking CloneProof to inspect setup readiness.'
      );
    } else {
      const nestedRecommendation = nestedPackageFiles.length > 0
        ? ' Run CloneProof separately on each nested package directory.'
        : '';
      addFinding(
        findings,
        'UNSUPPORTED_ROOT',
        'warning',
        'warning',
        'The root project is outside CloneProof’s dynamic Node.js profile.',
        ecosystemMarker
          ? `Detected a ${ecosystemMarker.ecosystem} project marker at ${ecosystemMarker.path}.`
          : 'No package.json or Node.js source at the top level.',
        ecosystemMarker
          ? [makeEvidence(ecosystemMarker.path, `Detected ${ecosystemMarker.ecosystem} project marker.`)]
          : [],
        `Point CloneProof at a supported Node.js or TypeScript repository.${nestedRecommendation}`
      );
    }
  }

  if (!supportedProject || scanned.rootState !== 'ok') return createReport();

  let missingLockfileFinding = null;
  if (projectType !== 'unsupported' && scanned.rootState === 'ok') {
    if (lockfiles.length === 0) {
      missingLockfileFinding = addFinding(
        findings,
        'LOCKFILE_MISSING',
        'warning',
        'warning',
        'No npm, pnpm, or Yarn lockfile was found at the repository root.',
        'Dependency versions cannot be reproduced from a checked-in root lockfile.',
        packageState === 'scanned'
          ? [makeEvidence('package.json', 'The package manifest has no recognized root lockfile beside it.')]
          : [],
        'Commit the lockfile used by the project and keep it synchronized with package.json.'
      );
    } else {
      addFinding(
        findings,
        'LOCKFILE_PRESENT',
        'passed',
        'info',
        'A root dependency lockfile is present',
        `Found ${lockfiles.map((lockfile) => lockfile.name).join(', ')}.`,
        lockfiles.map((lockfile) => makeEvidence(lockfile.name, 'Recognized dependency lockfile.')),
        'Keep one authoritative lockfile checked into the repository.'
      );
      if (lockfiles.length > 1) {
        addFinding(
          findings,
          'MULTIPLE_LOCKFILES',
          'warning',
          'warning',
          'Multiple package-manager lockfiles are present',
          'More than one recognized lockfile was found at the repository root.',
          lockfiles.map((lockfile) => makeEvidence(lockfile.name, 'Recognized root lockfile.')),
          'Keep only the lockfile for the package manager used by this project.'
        );
      }

      for (const lockfile of lockfiles.filter((candidate) => candidate.packageManager === 'npm')) {
        if (!scanned.files.has(lockfile.name)) continue;
        const parsedLockfile = parseReadableNpmLockfile(scanned.files.get(lockfile.name));
        const lockfileValid = Boolean(parsedLockfile);

        if (!lockfileValid) {
          addFinding(
            findings,
            'LOCKFILE_INVALID',
            'failed',
            'error',
            'The npm lockfile is malformed',
            `${lockfile.name} is present but could not be parsed as a valid npm lockfile metadata object.`,
            [makeEvidence(lockfile.name, 'The npm lockfile did not contain valid JSON lockfile metadata.')],
            'Regenerate the lockfile with the project package manager and commit the corrected file.'
          );
        } else if (packageValid) {
          coverage.mark(CHECK_GROUPS.INSTALL_SCRIPTS);
          addLockfileSyncFinding(
            findings,
            packageText,
            lockfile.name,
            scanned.files.get(lockfile.name),
            packageData
          );
          addInstallScriptsSkippedFinding(
            findings,
            lockfile.name,
            parsedLockfile,
            packageData
          );
        }
      }
    }
  }

  if (supportedProject && scanned.rootState === 'ok') {
    coverage.mark(CHECK_GROUPS.PACKAGE_SOURCES);
    const privateRegistry = collectPrivateRegistryHosts(scanned.files, lockfiles, packageData || {});
    if (privateRegistry.hosts.length > 0) {
      addFinding(
        findings,
        'PRIVATE_REGISTRY',
        'warning',
        'warning',
        'Non-public package registry or dependency hosts were detected',
        `Dependency metadata references non-public hosts: ${cappedHosts(privateRegistry.hosts)}.`,
        privateRegistry.evidence,
        'Provide registry credentials through the trusted verification environment and keep them out of repository files and reports.'
      );
    }
    if (privateRegistry.gitHosts.length > 0) {
      addFinding(
        findings,
        'GIT_DEPENDENCIES',
        'skipped',
        'info',
        'Public Git dependencies were detected',
        `Installing dependencies needs network access to public Git hosts: ${cappedHosts(privateRegistry.gitHosts)}.${privateRegistry.gitUsesSsh ? ' SSH access may be needed.' : ''}`,
        privateRegistry.gitEvidence,
        'Allow network access only when the verification environment needs to fetch these dependencies.'
      );
    }

    coverage.mark(CHECK_GROUPS.SERVICE_INDICATORS);
    const serviceReferences = likelyServiceReferences(scanned, packageData || {});
    if (serviceReferences.length > 0) {
      addFinding(
        findings,
        'SERVICES_LIKELY_REQUIRED',
        'skipped',
        'info',
        'External services may be required',
        `Found service indicators: ${serviceReferences.map((reference) => reference.label).join(', ')}.`,
        serviceReferences.flatMap((reference) => reference.evidence),
        'Confirm the required databases, caches, brokers, or compose services before relying on a fresh-clone setup.'
      );
    }
  }

  let missingTestFinding = null;
  let placeholderTestFinding = null;
  if (packageValid) {
    const rawScripts = packageData.scripts && typeof packageData.scripts === 'object' && !Array.isArray(packageData.scripts)
      ? packageData.scripts
      : {};
    const testValue = Object.prototype.hasOwnProperty.call(rawScripts, 'test') ? rawScripts.test : null;
    const testLine = packageText ? firstMatchLine(packageText, /"test"\s*:/) : undefined;
    if (typeof testValue === 'string' && /no test specified/i.test(testValue)) {
      placeholderTestFinding = addFinding(
        findings,
        'TEST_SCRIPT_PLACEHOLDER',
        'failed',
        'error',
        'The package test script is npm’s placeholder',
        'scripts.test still uses npm’s default “Error: no test specified” placeholder instead of running a test suite.',
        [makeEvidence('package.json', 'scripts.test contains the npm placeholder command.', testLine)],
        'Replace the placeholder with a deterministic command that runs the repository test suite.'
      );
    } else if (typeof testValue === 'string' && testValue.trim()) {
      addFinding(
        findings,
        'TEST_SCRIPT_PRESENT',
        'passed',
        'info',
        'A package test script is defined',
        'package.json defines a non-empty scripts.test entry.',
        [makeEvidence('package.json', 'scripts.test is defined.', testLine)],
        'Keep the test script deterministic and documented.'
      );
    } else {
      missingTestFinding = addFinding(
        findings,
        'TEST_SCRIPT_MISSING',
        'failed',
        'error',
        'The package test script is missing',
        'package.json does not define a non-empty scripts.test entry.',
        [makeEvidence('package.json', 'scripts.test is missing or empty.')],
        'Add a deterministic scripts.test command that runs the repository test suite.'
      );
    }
  } else if (
    (packageState !== 'absent' && !packageValid)
    || packageState === 'unscanned'
    || packageState === 'skipped'
    || (packageState === 'absent' && projectType !== 'unsupported')
  ) {
    addFinding(
      findings,
      'TEST_SCRIPT_CHECK_SKIPPED',
      'skipped',
      'info',
      'The package test script could not be checked',
      'A readable root package manifest was not available for this check.',
      packageState === 'unscanned' || packageState === 'skipped'
        ? [makeEvidence('package.json', 'Package manifest was not available to inspect.')]
        : [],
      'Provide a readable package.json and run the scan again.'
    );
  }

  if (packageValid) {
    const gitMetadataReferences = testLifecycleGitMetadataReferences(scripts, packageText);
    if (gitMetadataReferences.length > 0) {
      const scriptNames = [...new Set(gitMetadataReferences.map((reference) => reference.scriptName))];
      const referenceLabels = [...new Set(gitMetadataReferences.map((reference) => reference.label))];
      addFinding(
        findings,
        'GIT_METADATA_REQUIRED',
        'skipped',
        'info',
        'The test lifecycle may require Git metadata',
        `Test lifecycle scripts ${scriptNames.join(', ')} refer to ${referenceLabels.join(', ')}; a Docker snapshot does not include the repository's .git metadata.`,
        gitMetadataReferences.map((reference) => makeEvidence(
          'package.json',
          `scripts.${reference.scriptName} refers to ${reference.label}.`,
          reference.line
        )),
        'Confirm that npm test works without .git metadata, or provide the required metadata through a separately trusted workflow.'
      );
    }
  }

  if (packageValid && typeof scripts.test === 'string' && scripts.test.trim() && !placeholderTestFinding) {
    coverage.mark(CHECK_GROUPS.BROWSER_TESTS);
    const browserDependencies = browserTestDependencyNames(packageData);
    const browserWorkflow = browserTestWorkflow(scripts);
    if (browserDependencies.length > 0 && browserWorkflow.runners.length > 0) {
      const evidence = [
        ...browserDependencies.map((name) => makeEvidence(
          'package.json',
          `devDependencies includes ${name}.`,
          packageText ? firstMatchLine(packageText, regexForPackageName(name)) : undefined
        )),
        ...browserWorkflow.scriptNames.map((name) => makeEvidence(
          'package.json',
          `scripts.${name} participates in the npm test workflow.`,
          packageText ? firstMatchLine(packageText, regexForPackageName(name)) : undefined
        ))
      ];
      addFinding(
        findings,
        'BROWSER_TESTS_DETECTED',
        'warning',
        'warning',
        'Browser test tooling is part of the package test workflow',
        `Root devDependencies include ${browserDependencies.join(', ')}, and the npm test workflow references ${browserWorkflow.runners.join(', ')}.`,
        evidence,
        'Ensure the required browser executable is available before relying on Docker verification for npm test.'
      );
    }
  }

  const testFiles = [...scanned.files.keys()]
    .filter(isTestPath)
    .sort(compareStrings);
  if (testFiles.length > 0) {
    addFinding(
      findings,
      'TEST_FILES_FOUND',
      'passed',
      'info',
      'Test files are present',
      `Found ${testFiles.length} recognized test file${testFiles.length === 1 ? '' : 's'}.`,
      [makeEvidence(testFiles[0], 'Recognized test file.')],
      'Keep tests close to the package test script and include them in the repository.'
    );
  }

  const readmePath = findRootFile(['README.md', 'README.markdown', 'README'], scanned.discovered);
  const readmeState = readmePath
    ? stateFor(readmePath, scanned.files, scanned.discovered, scanned.skipped)
    : 'absent';
  if (
    supportedProject
    && scanned.rootState === 'ok'
    && ['scanned', 'unscanned', 'skipped'].includes(readmeState)
  ) {
    coverage.mark(CHECK_GROUPS.README_COMMANDS);
  }
  let readmeReferences = [];
  let readmeSetupCommands = [];
  let readmeText = null;
  if (readmeState === 'scanned') {
    readmeText = decodeText(scanned.files.get(readmePath));
    const parsedReadme = parseReadmeCommands(readmeText, {
      repositoryName: scanOptions.repositoryName,
      rootName: rootName(absoluteRoot),
      packageName: packageData && packageData.name
    });
    readmeReferences = parsedReadme.references;
    readmeSetupCommands = parsedReadme.setupCommands;
    if (parsedReadme.otherProjectLines.length > 0) {
      addFinding(
        findings,
        'README_OTHER_PROJECT_COMMANDS',
        'skipped',
        'info',
        'README commands for another project were ignored',
        `Ignored README commands for another project: ${parsedReadme.otherProjectLines
          .map((entry) => `line ${entry.line} ${entry.text}`)
          .join('; ')}.`,
        parsedReadme.otherProjectLines.map((entry) => makeEvidence(
          readmePath,
          'README command was associated with a different project.',
          entry.line
        )),
        'Run CloneProof separately on the generated or nested project when it needs verification.'
      );
    }
  } else if (readmeState === 'unscanned' || readmeState === 'skipped') {
    addFinding(
      findings,
      'README_CHECK_SKIPPED',
      'skipped',
      'info',
      'README commands could not be inspected',
      'A root README was discovered but was not included in the readable scan set.',
      [makeEvidence(readmePath, 'README was not available to inspect.')],
      'Increase the scan bounds or make the README readable, then run the scan again.'
    );
  }

  const buildOutputFinding = packageBuildOutputFinding(
    absoluteRoot,
    scanned,
    packageData,
    scripts,
    readmeState,
    readmeText
  );
  if (
    packageValid
    && typeof scripts.build === 'string'
    && scripts.build.trim()
    && !['unscanned', 'skipped'].includes(readmeState)
  ) {
    coverage.mark(CHECK_GROUPS.BUILD_OUTPUT);
  }
  if (buildOutputFinding) {
    addFinding(
      findings,
      'BUILD_OUTPUT_MISSING',
      'skipped',
      'info',
      'A declared build output file is missing',
      buildOutputFinding.message,
      buildOutputFinding.evidence,
      'Run the documented build before relying on package entrypoints, or commit the generated output when the project requires it.'
    );
  }

  if (
    readmeSetupCommands.length > 0
    && packageManagerInfo
    && supportedProject
    && scanned.rootState === 'ok'
  ) {
    const expectedManager = packageManagerInfo.name;
    const hasCorrectSetup = readmeSetupCommands.some((command) => command.manager === expectedManager);
    if (!hasCorrectSetup) {
      const managers = [...new Set(readmeSetupCommands.map((command) => command.manager))].sort(compareStrings);
      addFinding(
        findings,
        'README_PACKAGE_MANAGER_MISMATCH',
        'warning',
        'warning',
        'README setup commands use a different package manager',
        `README setup commands use ${managers.join(', ')}, but the project package manager is ${expectedManager}.`,
        readmeSetupCommands.map((command) => makeEvidence(
          readmePath,
          `README uses a ${command.manager} setup command.`,
          command.line
        )),
        `Document the ${expectedManager} setup command used by the project, or update the package metadata and lockfile consistently.`
      );
    }
  }

  for (const reference of readmeReferences) {
    const evidence = [makeEvidence(readmePath, reference.detail, reference.line)];
    if (reference.kind === 'ci') {
      if (lockfiles.length > 0) {
        addFinding(
          findings,
          'README_CI_COMMAND',
          'passed',
          'info',
          'README install command has a lockfile',
          'README references npm ci and a recognized root lockfile is present.',
          evidence,
          'Keep the README command and lockfile in sync.'
        );
      } else if (missingLockfileFinding) {
        missingLockfileFinding.evidence.push(...evidence);
      } else {
        addFinding(
          findings,
          'README_CI_CHECK_SKIPPED',
          'skipped',
          'info',
          'README npm ci command could not be checked',
          'The project type or root scan did not provide enough package metadata for this check.',
          evidence,
          'Provide a readable Node.js project root and dependency lockfile.'
        );
      }
      continue;
    }

    if (reference.kind === 'install') {
      addFinding(
        findings,
        'README_INSTALL_COMMAND',
        'passed',
        'info',
        'README documents npm install',
        'README contains a recognizable npm install command.',
        evidence,
        'Keep documented installation commands accurate.'
      );
      continue;
    }

    if (reference.kind === 'test') {
      if (packageValid && typeof scripts.test === 'string' && scripts.test.trim() && !placeholderTestFinding) {
        addFinding(
          findings,
          'README_TEST_COMMAND',
          'passed',
          'info',
          'README documents the package test command',
          'README references npm test and package.json defines scripts.test.',
          evidence,
          'Keep the README test command aligned with scripts.test.'
        );
      } else if (missingTestFinding || placeholderTestFinding) {
        (missingTestFinding || placeholderTestFinding).evidence.push(...evidence);
      } else {
        addFinding(
          findings,
          'README_TEST_CHECK_SKIPPED',
          'skipped',
          'info',
          'README test command could not be checked',
          'A readable root package manifest was not available for comparison.',
          evidence,
          'Provide a readable package.json and run the scan again.'
        );
      }
      continue;
    }

    if (reference.kind === 'start') {
      const hasStartScript = packageValid && Object.prototype.hasOwnProperty.call(scripts, 'start');
      const hasRootServer = Boolean(findRootFile(['server.js'], scanned.discovered));
      if (hasStartScript || hasRootServer) {
        addFinding(
          findings,
          'README_SCRIPT_REFERENCE',
          'passed',
          'info',
          'README references a valid npm start command',
          hasStartScript
            ? 'README references npm start and package.json defines scripts.start.'
            : 'README references npm start and a root server.js entrypoint is present.',
          evidence,
          'Keep the README start command aligned with the package entrypoint.'
        );
      } else if (packageValid) {
        addFinding(
          findings,
          'README_START_COMMAND_UNKNOWN',
          'warning',
          'warning',
          'README references an unknown npm start command',
          'README references npm start, but package.json does not define scripts.start and no root server.js entrypoint is present.',
          evidence,
          'Define scripts.start or add a root server.js entrypoint when this repository is expected to start an application.'
        );
      } else {
        addFinding(
          findings,
          'README_SCRIPT_CHECK_SKIPPED',
          'skipped',
          'info',
          'README npm start reference could not be checked',
          'README references npm start, but package scripts were unavailable.',
          evidence,
          'Provide a readable package.json and run the scan again.'
        );
      }
      continue;
    }

    if (reference.kind === 'run') {
      const scriptName = reference.scriptName;
      if (packageValid) {
        if (Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
          addFinding(
            findings,
            'README_SCRIPT_REFERENCE',
            'passed',
            'info',
            'README references a defined npm script',
            `${reference.detail.replace(/\.$/, '')}, which is defined in package.json.`,
            evidence,
            'Keep README script names synchronized with package.json.'
          );
        } else if (scriptName === 'test' && (missingTestFinding || placeholderTestFinding)) {
          (missingTestFinding || placeholderTestFinding).evidence.push(...evidence);
        } else {
          addFinding(
            findings,
            'README_SCRIPT_UNKNOWN',
            'failed',
            'error',
            'README references an unknown npm script',
            `${reference.detail.replace(/\.$/, '')}, but package.json does not define that script.`,
            evidence,
            `Define scripts.${scriptName} or update the README command.`
          );
        }
      } else {
        addFinding(
          findings,
          'README_SCRIPT_CHECK_SKIPPED',
          'skipped',
          'info',
          'README npm script reference could not be checked',
          `${reference.detail.replace(/\.$/, '')}, but package scripts were unavailable.`,
          evidence,
          'Provide a readable package.json and run the scan again.'
        );
      }
    }
  }

  const allSourceFiles = [...scanned.discovered.keys()].filter(isReadableSourcePath).sort(compareStrings);
  const applicationSourceFiles = allSourceFiles.filter((relativePath) => (
    !isTestPath(relativePath) && !isUnderNestedPackage(relativePath, nestedPackageFiles)
  ));
  if (scanned.rootState === 'ok' && applicationSourceFiles.length > 0) {
    coverage.mark(CHECK_GROUPS.ENV_DOCUMENTATION);
  }
  const environmentSourceFiles = applicationSourceFiles.filter((relativePath) => (
    !isEnvironmentAnalysisExcludedPath(relativePath)
  ));
  const scannedSourceFiles = environmentSourceFiles.filter((relativePath) => scanned.files.has(relativePath));
  const unscannedSourceFiles = environmentSourceFiles.filter((relativePath) => !scanned.files.has(relativePath));
  const environmentReferences = new Map();
  for (const relativePath of scannedSourceFiles) {
    const references = extractEnvironmentReferences(
      decodeText(scanned.files.get(relativePath)),
      relativePath
    );
    for (const [key, evidence] of references) {
      if (!isConventionalEnvironmentKey(key) && !environmentReferences.has(key)) {
        environmentReferences.set(key, evidence);
      }
    }
  }

  const envTemplatePaths = ['.env.example', '.env.sample'];
  const envTemplates = [];
  const unscannedEnvTemplates = [];
  for (const relativePath of envTemplatePaths) {
    const state = stateFor(relativePath, scanned.files, scanned.discovered, scanned.skipped);
    if (state === 'scanned') {
      envTemplates.push({ path: relativePath, keys: parseEnvTemplate(decodeText(scanned.files.get(relativePath))) });
    } else if (state === 'unscanned' || state === 'skipped') {
      unscannedEnvTemplates.push(relativePath);
    }
  }

  const depthSkippedEnvironmentPaths = [...scanned.depthSkipped]
    .filter((relativePath) => !isEnvironmentAnalysisExcludedPath(relativePath))
    .sort(compareStrings);
  const unscannedEnvironmentPaths = [
    ...unscannedSourceFiles,
    ...unscannedEnvTemplates,
    ...depthSkippedEnvironmentPaths
  ].sort(compareStrings);
  if (unscannedEnvironmentPaths.length > 0 && (applicationSourceFiles.length > 0 || depthSkippedEnvironmentPaths.length > 0)) {
    const totalUnscannedEnvironmentPaths = unscannedEnvironmentPaths.length;
    const visibleEnvironmentPaths = unscannedEnvironmentPaths.slice(0, 50);
    const remainingEnvironmentPaths = totalUnscannedEnvironmentPaths - visibleEnvironmentPaths.length;
    addFinding(
      findings,
      'ENV_CHECK_SKIPPED',
      'skipped',
      'info',
      'Environment references could not be fully checked',
      `At least ${totalUnscannedEnvironmentPaths} source or environment template file${totalUnscannedEnvironmentPaths === 1 ? '' : 's'} were outside the readable scan set${remainingEnvironmentPaths > 0 ? `; ${remainingEnvironmentPaths} more path${remainingEnvironmentPaths === 1 ? '' : 's'} are omitted from evidence` : ''}.`,
      visibleEnvironmentPaths.map((relativePath) => makeEvidence(
        relativePath,
        depthSkippedEnvironmentPaths.includes(relativePath)
          ? 'Directory was outside the configured maximum scan depth.'
          : 'File was not available for environment-variable inspection.'
      )),
      'Increase the scan bounds and run the scan again.'
    );
  } else if (environmentReferences.size > 0) {
    const documentedKeys = new Map();
    for (const template of envTemplates) {
      for (const [key, line] of template.keys) {
        if (!documentedKeys.has(key)) documentedKeys.set(key, { path: template.path, line });
      }
    }

    const missingKeys = [...environmentReferences.keys()]
      .filter((key) => !documentedKeys.has(key))
      .sort(compareStrings);

    if (envTemplates.length === 0) {
      addFinding(
        findings,
        'ENV_EXAMPLE_MISSING',
        'warning',
        'warning',
        'No environment example file documents the source environment keys',
        `Source references ${missingKeys.join(', ')}, but neither .env.example nor .env.sample is present.`,
        [...environmentReferences.entries()].map(([key, evidence]) => makeEvidence(
          evidence.path,
          `Source references undocumented environment key ${key}.`,
          evidence.line
        )),
        'Add .env.example or .env.sample with safe placeholder values for every referenced key.'
      );
    } else {
      for (const key of missingKeys) {
        const sourceEvidence = environmentReferences.get(key);
        addFinding(
          findings,
          'ENV_KEY_MISSING',
          'warning',
          'warning',
          `Environment key ${key} is missing from the example configuration`,
          `Source references ${key}, but no scanned .env.example or .env.sample defines it.`,
          [sourceEvidence],
          'Document the key in .env.example or .env.sample without committing a real secret.'
        );
      }

      for (const key of [...environmentReferences.keys()]
        .filter((environmentKey) => documentedKeys.has(environmentKey))
        .sort(compareStrings)) {
        const sourceEvidence = environmentReferences.get(key);
        const templateEvidence = documentedKeys.get(key);
        addFinding(
          findings,
          'ENV_KEY_DOCUMENTED',
          'passed',
          'info',
          `Environment key ${key} is documented`,
          `Source references ${key} and an environment example defines it.`,
          [
            sourceEvidence,
            makeEvidence(templateEvidence.path, `Example configuration defines ${key}.`, templateEvidence.line)
          ],
          'Keep the example configuration synchronized with source references.'
        );
      }
    }
  }

  if (nvmrcState === 'scanned') {
    if (nvmrc) {
      addFinding(
        findings,
        'NVMRC_PRESENT',
        'passed',
        'info',
        'Node runtime is pinned by .nvmrc',
        `The repository declares Node.js ${nvmrc} in .nvmrc.`,
        [makeEvidence('.nvmrc', 'Node runtime declaration.')],
        'Keep .nvmrc aligned with the supported Node.js runtime.'
      );
    } else {
      addFinding(
        findings,
        'NVMRC_EMPTY',
        'warning',
        'warning',
        '.nvmrc is empty',
        'The repository contains .nvmrc but it does not declare a runtime version.',
        [makeEvidence('.nvmrc', 'Empty Node runtime declaration.')],
        'Put a concrete Node.js runtime version in .nvmrc.'
      );
    }
  } else if (nvmrcState === 'unscanned' || nvmrcState === 'skipped') {
    addFinding(
      findings,
      'NVMRC_CHECK_SKIPPED',
      'skipped',
      'info',
      '.nvmrc could not be inspected',
      'A runtime declaration was discovered but was not included in the readable scan set.',
      [makeEvidence('.nvmrc', 'Runtime declaration was not available to inspect.')],
      'Increase the scan bounds or make .nvmrc readable, then run the scan again.'
    );
  }

  if (nodeVersionState === 'scanned') {
    if (nodeVersion) {
      addFinding(
        findings,
        'NODE_VERSION_PRESENT',
        'passed',
        'info',
        'Node runtime is pinned by .node-version',
        `The repository declares Node.js ${nodeVersion} in .node-version.`,
        [makeEvidence('.node-version', 'Node runtime declaration.')],
        'Keep .node-version aligned with the supported Node.js runtime.'
      );
    } else {
      addFinding(
        findings,
        'NODE_VERSION_EMPTY',
        'warning',
        'warning',
        '.node-version is empty',
        'The repository contains .node-version but it does not declare a runtime version.',
        [makeEvidence('.node-version', 'Empty Node runtime declaration.')],
        'Put a concrete Node.js runtime version in .node-version.'
      );
    }
  } else if (nodeVersionState === 'unscanned' || nodeVersionState === 'skipped') {
    addFinding(
      findings,
      'NODE_VERSION_CHECK_SKIPPED',
      'skipped',
      'info',
      '.node-version could not be inspected',
      'A runtime declaration was discovered but was not included in the readable scan set.',
      [makeEvidence('.node-version', 'Runtime declaration was not available to inspect.')],
      'Increase the scan bounds or make .node-version readable, then run the scan again.'
    );
  }

  if (enginesNode) {
    const enginesLine = packageText ? firstMatchLine(packageText, /"node"\s*:/) : undefined;
    addFinding(
      findings,
      'ENGINES_NODE_PRESENT',
      'passed',
      'info',
      'package.json declares a Node engine',
      `package.json declares engines.node as ${enginesNode}.`,
      [makeEvidence('package.json', 'Node engine declaration.', enginesLine)],
      'Keep engines.node aligned with the project runtime.'
    );
  }

  if (dockerNode.length > 0) {
    addFinding(
      findings,
      'DOCKER_NODE_BASE_PRESENT',
      'passed',
      'info',
      'Dockerfile Node base versions were detected',
      `Detected Node base version${dockerNode.length === 1 ? '' : 's'}: ${dockerNode.join(', ')}.`,
       dockerDeclarations.map((declaration) => makeEvidence(
         declaration.path,
         `Node base image declaration: ${declaration.raw}.`
       )),
       'Keep Dockerfile Node bases aligned with the project runtime.'
     );
  }

  const runtimeDeclarations = [];
  for (const [value, declarationPath, detail] of [
    [nvmrc, '.nvmrc', 'Runtime declared in .nvmrc.'],
    [nodeVersion, '.node-version', 'Runtime declared in .node-version.']
  ]) {
    const parsed = parsePinnedRuntime(value);
    if (parsed) runtimeDeclarations.push({ ...parsed, path: declarationPath, detail });
  }
  for (const declaration of dockerDeclarations) runtimeDeclarations.push(declaration);
  const enginesExact = exactRuntimeVersion(enginesNode);
  if (enginesExact) {
    const parsed = parsePinnedRuntime(enginesExact);
    if (parsed) runtimeDeclarations.push({ ...parsed, path: 'package.json', detail: 'Exact engines.node runtime declaration.' });
  }

  const exactVersions = [...new Set(runtimeDeclarations
    .filter((declaration) => declaration.full)
    .map((declaration) => `${declaration.major}.${declaration.minor}.${declaration.patch}`))]
    .sort(compareStrings);
  const majorVersions = [...new Set(runtimeDeclarations.map((declaration) => declaration.major))].sort((left, right) => left - right);
  const runtimeMismatch = exactVersions.length > 1 || majorVersions.length > 1;
  if (runtimeMismatch) {
    addFinding(
      findings,
      'RUNTIME_VERSION_MISMATCH',
      'warning',
      'warning',
      'Runtime declarations disagree',
      `Node.js declarations contain ${majorVersions.length > 1 ? `multiple major versions (${majorVersions.join(', ')})` : `multiple exact versions (${exactVersions.join(', ')})`}.`,
      runtimeDeclarations.map((declaration) => makeEvidence(
        declaration.path,
        `${declaration.detail} Found ${declaration.raw || `${declaration.major}.${declaration.minor ?? 'x'}.${declaration.patch ?? 'x'}`}.`
      )),
      'Choose one supported Node.js version and align .nvmrc, engines.node, and Dockerfile base images.'
    );
  }

  if (enginesNode && !enginesExact) {
    const unsupportedRange = runtimeDeclarations
      .filter((declaration) => declaration.path !== 'package.json')
      .map((declaration) => ({ declaration, result: satisfiesEngineRange(declaration, enginesNode) }))
      .find((item) => item.result === false);
    if (unsupportedRange) {
      addFinding(
        findings,
        'ENGINES_NODE_UNSATISFIED',
        'warning',
        'warning',
        'A pinned Node runtime does not satisfy engines.node',
        `${unsupportedRange.declaration.path} declares Node.js ${unsupportedRange.declaration.raw}, which does not satisfy engines.node ${enginesNode}.`,
        [
          makeEvidence(unsupportedRange.declaration.path, 'Pinned Node runtime declaration.'),
          makeEvidence('package.json', 'Node engine range declaration.', packageText ? firstMatchLine(packageText, /"node"\s*:/) : undefined)
        ],
        'Align the pinned runtime with the engines.node range or update the supported engine range.'
      );
    }
  }

  if (unscannedDockerFiles.length > 0) {
    addFinding(
      findings,
      'DOCKER_NODE_CHECK_SKIPPED',
      'skipped',
      'info',
      'Dockerfile runtime declarations could not be fully inspected',
      'At least one Dockerfile was outside the readable scan set.',
      unscannedDockerFiles.map((relativePath) => makeEvidence(relativePath, 'Dockerfile was not available to inspect.')),
      'Increase the scan bounds and run the scan again.'
    );
  }

  return createReport();
}

module.exports = {
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  NOT_CHECKED,
  classifyLstatFailure,
  isCoreFile,
  loadGitignoreMatcher,
  scanRepository
};
