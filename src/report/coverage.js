'use strict';

/**
 * Stable identifiers for the static check groups represented by a report.
 * Keep these values suitable for machine-readable reports; display labels live
 * alongside them so renderers do not need to infer meaning from an id.
 */
const CHECK_GROUPS = Object.freeze({
  PACKAGE_MANIFEST: 'package-manifest',
  LOCKFILE: 'lockfile-presence-validity-sync',
  PACKAGE_MANAGER: 'package-manager-consistency',
  TEST_SCRIPT: 'test-script',
  README_COMMANDS: 'readme-npm-commands',
  ENV_DOCUMENTATION: 'env-documentation',
  NODE_RUNTIME: 'node-runtime-declarations',
  GITIGNORED_CORE_FILES: 'gitignored-core-files',
  INSTALL_SCRIPTS: 'install-scripts',
  BROWSER_TESTS: 'browser-tests',
  NESTED_PACKAGES: 'nested-packages',
  PROJECT_CLASSIFICATION: 'project-classification'
});

const CHECK_GROUP_IDS = Object.freeze(Object.values(CHECK_GROUPS));

/**
 * Scope exclusions are deliberately stable and are copied into every report.
 * They describe questions CloneProof does not answer, rather than checks that
 * happened to be skipped for one target.
 */
const NOT_CHECKED = Object.freeze([
  'build-steps-generated-output',
  'services-databases-caches',
  'os-specific-scripts',
  'private-registry-credentials',
  'non-readme-documentation-commands',
  'verify-browser-native-build-tests'
]);

const CHECK_GROUP_LABELS = Object.freeze({
  [CHECK_GROUPS.PACKAGE_MANIFEST]: 'Package manifest',
  [CHECK_GROUPS.LOCKFILE]: 'Lockfile presence, validity, and synchronization',
  [CHECK_GROUPS.PACKAGE_MANAGER]: 'Package-manager consistency',
  [CHECK_GROUPS.TEST_SCRIPT]: 'Test script',
  [CHECK_GROUPS.README_COMMANDS]: 'README npm commands',
  [CHECK_GROUPS.ENV_DOCUMENTATION]: 'Environment documentation',
  [CHECK_GROUPS.NODE_RUNTIME]: 'Node runtime declarations',
  [CHECK_GROUPS.GITIGNORED_CORE_FILES]: 'Gitignored core files',
  [CHECK_GROUPS.INSTALL_SCRIPTS]: 'Install scripts',
  [CHECK_GROUPS.BROWSER_TESTS]: 'Browser tests',
  [CHECK_GROUPS.NESTED_PACKAGES]: 'Nested packages',
  [CHECK_GROUPS.PROJECT_CLASSIFICATION]: 'Project classification'
});

const NOT_CHECKED_LABELS = Object.freeze({
  'build-steps-generated-output': 'Build steps and generated output',
  'services-databases-caches': 'Services such as databases and caches',
  'os-specific-scripts': 'OS-specific scripts',
  'private-registry-credentials': 'Private registry credentials',
  'non-readme-documentation-commands': 'Non-README documentation commands',
  'verify-browser-native-build-tests': 'Browser and native-build tests in verify'
});

function createCoverage(checked = []) {
  const requested = new Set(Array.isArray(checked) ? checked : []);
  return {
    checked: CHECK_GROUP_IDS.filter((id) => requested.has(id)),
    notChecked: [...NOT_CHECKED]
  };
}

function createCoverageTracker(initial = []) {
  const checked = new Set();
  for (const id of Array.isArray(initial) ? initial : []) {
    if (CHECK_GROUP_IDS.includes(id)) checked.add(id);
  }

  return {
    mark(id) {
      if (CHECK_GROUP_IDS.includes(id)) checked.add(id);
    },
    snapshot() {
      return createCoverage([...checked]);
    }
  };
}

module.exports = {
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  CHECK_GROUP_LABELS,
  NOT_CHECKED,
  NOT_CHECKED_LABELS,
  createCoverage,
  createCoverageTracker
};
