'use strict';

const fs = require('node:fs');
const path = require('node:path');

function existingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile() ? fs.realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

function isAbsoluteForPlatform(value, platform) {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
  }
  return value.startsWith('/');
}

function joinForPlatform(platform, ...parts) {
  return platform === 'win32' ? path.win32.join(...parts) : path.posix.join(...parts);
}

function pathDelimiter(platform) {
  return platform === 'win32' ? ';' : ':';
}

function resolveFromCandidates(candidates, { platform, env, lookup, executableName }) {
  const pathValue = env.PATH || env.Path || '';
  for (const directory of pathValue.split(pathDelimiter(platform))) {
    if (!directory || !isAbsoluteForPlatform(directory, platform)) continue;
    candidates.push(joinForPlatform(
      platform,
      directory,
      platform === 'win32' ? `${executableName}.exe` : executableName
    ));
  }

  for (const candidate of candidates) {
    const resolved = lookup(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function resolveGitExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const lookup = options.lookup || existingFile;
  const candidates = [];

  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programW6432 = env.ProgramW6432;
    const localAppData = env.LOCALAPPDATA;
    candidates.push(joinForPlatform(platform, programFiles, 'Git', 'cmd', 'git.exe'));
    if (programW6432) candidates.push(joinForPlatform(platform, programW6432, 'Git', 'cmd', 'git.exe'));
    if (localAppData) candidates.push(joinForPlatform(platform, localAppData, 'Programs', 'Git', 'cmd', 'git.exe'));
  } else {
    candidates.push('/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git');
  }

  return resolveFromCandidates(candidates, {
    platform,
    env,
    lookup: (candidate) => lookup(candidate),
    executableName: 'git'
  });
}

function resolveDockerExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const lookup = options.lookup || existingFile;
  const candidates = [];

  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programW6432 = env.ProgramW6432 || programFiles;
    const localAppData = env.LOCALAPPDATA;
    candidates.push(
      joinForPlatform(platform, programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
      joinForPlatform(platform, programW6432, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
      ...(localAppData
        ? [joinForPlatform(platform, localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe')]
        : [])
    );
  } else {
    candidates.push('/usr/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/snap/bin/docker');
  }

  return resolveFromCandidates(candidates, {
    platform,
    env,
    lookup: (candidate) => {
      const value = lookup(candidate);
      return value ? value : null;
    },
    executableName: 'docker'
  });
}

module.exports = {
  existingFile,
  resolveDockerExecutable,
  resolveGitExecutable
};
