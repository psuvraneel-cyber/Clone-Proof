'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
  'FORCE_COLOR'
]);

function isConventionalEnvironmentKey(key) {
  return CONVENTIONAL_ENV_KEYS.has(key)
    || key.startsWith('npm_')
    || key.startsWith('GITHUB_')
    || key.startsWith('RUNNER_');
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

function regexForPackageName(name) {
  return new RegExp(`"${String(name).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"\\s*:`);
}

function cappedDifferenceNames(differences) {
  const names = [...new Set(differences.map((item) => item.name))].sort(compareStrings);
  const visible = names.slice(0, 20);
  const remaining = names.length - visible.length;
  return remaining > 0
    ? `${visible.join(', ')} (and ${remaining} more)`
    : visible.join(', ');
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
      declarations.push({ ...parsed, raw: normalizedRaw, tag, path: relativePath });
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
    full: parsed.full
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

function parseReadmeCommands(text) {
  const references = new Map();
  const lines = text.split(/\r?\n/);

  function addReference(key, kind, line, detail) {
    if (!references.has(key)) {
      references.set(key, { kind, line, detail, scriptName: null });
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;

    if (/\bnpm\s+test(?=$|[\s`'"),.;:!?])/i.test(line)) {
      addReference('test', 'test', lineNumber, 'README references npm test.');
    }

    const installExpression = /\bnpm\s+(ci|install)(?=$|[\s`'"),.;:!?])/gi;
    let installMatch = installExpression.exec(line);
    while (installMatch) {
      const kind = installMatch[1].toLowerCase();
      addReference(kind, kind, lineNumber, `README references npm ${kind}.`);
      installMatch = installExpression.exec(line);
    }

    const runExpression = /\bnpm\s+run\s+([^\s`'"<>]+)/gi;
    let runMatch = runExpression.exec(line);
    while (runMatch) {
      const scriptName = runMatch[1].replace(/[),.;:!?]+$/g, '');
      if (scriptName && !scriptName.startsWith('<')) {
        addReference(`run:${scriptName}`, 'run', lineNumber, `README references npm run ${scriptName}.`);
        references.get(`run:${scriptName}`).scriptName = scriptName;
      }
      runMatch = runExpression.exec(line);
    }
  }

  return [...references.values()];
}

function isCoreFile(relativePath) {
  if (relativePath.includes('/')) return false;
  const lower = relativePath.toLowerCase();
  return lower === 'package.json'
    || lower === 'package-lock.json'
    || lower === 'npm-shrinkwrap.json'
    || lower === 'pnpm-lock.yaml'
    || lower === 'yarn.lock'
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

function loadGitignoreMatcher(rootPath, freshClone) {
  if (freshClone) return null;
  const texts = [];
  const rootGitignore = readRegularIgnoreFile(path.join(rootPath, '.gitignore'));
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
  const errors = [];
  let complete = true;
  let fileCount = 0;
  let totalBytes = 0;
  let discoveredFileCount = 0;
  let entryCount = 0;
  let skippedPathsTruncated = false;
  let rootState = 'ok';
  let entryLimitExceeded = false;

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
      skippedPathsTruncated,
      errors,
      complete,
      fileCount,
      discoveredFileCount,
      totalBytes,
      rootState
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

  const ignoreMatcher = loadGitignoreMatcher(rootPath, options.freshClone === true);

  function visitDirectory(absoluteDirectory, relativeDirectory, depth, nestedPackageRoot = null) {
    if (entryLimitExceeded) return;
    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      addError(relativeDirectory, 'directory');
      return;
    }

    entries.sort((left, right) => compareStrings(left.name, right.name));
    const hasNestedPackageManifest = relativeDirectory !== '.'
      && entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'package.json');
    const activeNestedPackageRoot = nestedPackageRoot || (hasNestedPackageManifest ? relativeDirectory : null);

    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        complete = false;
        entryLimitExceeded = true;
        break;
      }

      const absoluteEntry = path.join(absoluteDirectory, entry.name);
      const relativeEntry = toRelativePath(rootPath, absoluteEntry);
      let entryStat;

      try {
        entryStat = fs.lstatSync(absoluteEntry);
      } catch {
        addError(relativeEntry, 'file');
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
      if (ignoreMatcher && ignoreMatcher.isIgnored(relativeEntry, false) && coreFile) {
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
  const scanned = scanFiles(absoluteRoot, limits, scanOptions);
  const findings = [];
  const packageState = stateFor('package.json', scanned.files, scanned.discovered, scanned.skipped);
  const nestedPackageFiles = nestedPackagePaths(scanned.discovered);
  const ecosystemMarker = rootEcosystemMarker(scanned.discovered);
  const projectType = inferProjectType(packageState, scanned.discovered, nestedPackageFiles, ecosystemMarker);
  const packageText = packageState === 'scanned'
    ? decodeText(scanned.files.get('package.json'))
    : null;

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

  const target = {
    kind: 'local',
    name: rootName(absoluteRoot)
  };

  if (nestedPackageFiles.length > 0) {
    const visibleNestedPackages = nestedPackageFiles.slice(0, 50);
    const remainingNestedPackages = nestedPackageFiles.length - visibleNestedPackages.length;
    addFinding(
      findings,
      'NESTED_PACKAGES_SKIPPED',
      'skipped',
      'info',
      'Nested packages were excluded from the root application checks',
      `Found nested package manifests: ${visibleNestedPackages.join(', ')}${remainingNestedPackages > 0 ? ` (and ${remainingNestedPackages} more)` : ''}.`,
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

  for (const relativePath of [...scanned.ignoredCorePaths].sort(compareStrings)) {
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
    const knownFile = ecosystemMarker
      ? ecosystemMarker.path
      : [...scanned.discovered.keys()].sort(compareStrings)[0];
    if (knownFile) {
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
          : 'No supported root Node.js or TypeScript project marker was found.',
        [makeEvidence(knownFile, ecosystemMarker
          ? `Detected ${ecosystemMarker.ecosystem} project marker.`
          : 'The scanned root did not contain a supported project marker.')],
        `Point CloneProof at a supported Node.js or TypeScript repository.${nestedRecommendation}`
      );
    } else if (scanned.fileCount === 0 && scanned.complete) {
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
    }
  }

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
        let lockfileValid = false;
        try {
          const parsedLockfile = JSON.parse(decodeText(scanned.files.get(lockfile.name)));
          lockfileValid = Boolean(
            parsedLockfile
            && typeof parsedLockfile === 'object'
            && !Array.isArray(parsedLockfile)
            && Number.isInteger(parsedLockfile.lockfileVersion)
          );
        } catch {
          lockfileValid = false;
        }

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
          addLockfileSyncFinding(
            findings,
            packageText,
            lockfile.name,
            scanned.files.get(lockfile.name),
            packageData
          );
        }
      }
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
  let readmeReferences = [];
  if (readmeState === 'scanned') {
    readmeReferences = parseReadmeCommands(decodeText(scanned.files.get(readmePath)));
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
            `README references npm run ${scriptName}, which is defined in package.json.`,
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
            `README references npm run ${scriptName}, but package.json does not define that script.`,
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
          `README references npm run ${scriptName}, but package scripts were unavailable.`,
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
  const scannedSourceFiles = applicationSourceFiles.filter((relativePath) => scanned.files.has(relativePath));
  const unscannedSourceFiles = applicationSourceFiles.filter((relativePath) => !scanned.files.has(relativePath));
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

  if (applicationSourceFiles.length > 0 && (unscannedSourceFiles.length > 0 || unscannedEnvTemplates.length > 0)) {
    addFinding(
      findings,
      'ENV_CHECK_SKIPPED',
      'skipped',
      'info',
      'Environment references could not be fully checked',
      'At least one source or environment template file was outside the readable scan set.',
      [...unscannedSourceFiles, ...unscannedEnvTemplates]
        .sort(compareStrings)
        .map((relativePath) => makeEvidence(relativePath, 'File was not available for environment-variable inspection.')),
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
    summary
  };
}

module.exports = { scanRepository };
