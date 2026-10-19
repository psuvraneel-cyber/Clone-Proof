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
  PROJECT_CLASSIFICATION: 'project-classification',
  PACKAGE_SOURCES: 'package-sources',
  BUILD_OUTPUT: 'build-output',
  SERVICE_INDICATORS: 'service-indicators'
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
  [CHECK_GROUPS.PROJECT_CLASSIFICATION]: 'Project classification',
  [CHECK_GROUPS.PACKAGE_SOURCES]: 'Package registries and Git dependency hosts',
  [CHECK_GROUPS.BUILD_OUTPUT]: 'Declared build output files',
  [CHECK_GROUPS.SERVICE_INDICATORS]: 'Compose files and service dependency indicators'
});

const NOT_CHECKED_LABELS = Object.freeze({
  'build-steps-generated-output': 'Running build steps (declared outputs are only checked for presence)',
  'services-databases-caches': 'Starting or reaching services (only indicators are detected)',
  'os-specific-scripts': 'OS-specific scripts',
  'private-registry-credentials': 'Registry credentials and access (only hosts are detected)',
  'non-readme-documentation-commands': 'Non-README documentation commands',
  'verify-browser-native-build-tests': 'Browser and native-build tests in verify'
});

const FINDING_CHECK_GROUPS = Object.freeze({
  // Target and scan-boundary findings do not represent one of the static
  // groups below. They describe why the report could not reach those checks.
  WRONG_TARGET: null,
  SCAN_ROOT_UNAVAILABLE: null,
  SCAN_ENTRY_LIMIT_EXCEEDED: null,
  SCAN_DIRECTORY_UNREADABLE: CHECK_GROUPS.PROJECT_CLASSIFICATION,
  SCAN_FILE_UNREADABLE: CHECK_GROUPS.PROJECT_CLASSIFICATION,
  PACKAGE_JSON_INVALID: CHECK_GROUPS.PACKAGE_MANIFEST,
  PACKAGE_JSON_PRESENT: CHECK_GROUPS.PACKAGE_MANIFEST,
  PACKAGE_JSON_MISSING: CHECK_GROUPS.PACKAGE_MANIFEST,
  PACKAGE_JSON_UNSCANNED: CHECK_GROUPS.PACKAGE_MANIFEST,
  PACKAGE_MANAGER_LOCKFILE_MISMATCH: CHECK_GROUPS.PACKAGE_MANAGER,
  NESTED_PACKAGES_SKIPPED: CHECK_GROUPS.NESTED_PACKAGES,
  UNSUPPORTED_ROOT: CHECK_GROUPS.PROJECT_CLASSIFICATION,
  EMPTY_REPOSITORY: CHECK_GROUPS.PROJECT_CLASSIFICATION,
  CORE_FILE_GITIGNORED: CHECK_GROUPS.GITIGNORED_CORE_FILES,
  LOCKFILE_MISSING: CHECK_GROUPS.LOCKFILE,
  LOCKFILE_PRESENT: CHECK_GROUPS.LOCKFILE,
  MULTIPLE_LOCKFILES: CHECK_GROUPS.LOCKFILE,
  LOCKFILE_INVALID: CHECK_GROUPS.LOCKFILE,
  LOCKFILE_OUT_OF_SYNC: CHECK_GROUPS.LOCKFILE,
  INSTALL_SCRIPTS_SKIPPED: CHECK_GROUPS.INSTALL_SCRIPTS,
  GIT_METADATA_REQUIRED: CHECK_GROUPS.TEST_SCRIPT,
  TEST_SCRIPT_PLACEHOLDER: CHECK_GROUPS.TEST_SCRIPT,
  TEST_SCRIPT_PRESENT: CHECK_GROUPS.TEST_SCRIPT,
  TEST_SCRIPT_MISSING: CHECK_GROUPS.TEST_SCRIPT,
  TEST_SCRIPT_CHECK_SKIPPED: CHECK_GROUPS.TEST_SCRIPT,
  TEST_FILES_FOUND: CHECK_GROUPS.PROJECT_CLASSIFICATION,
  BROWSER_TESTS_DETECTED: CHECK_GROUPS.BROWSER_TESTS,
  README_OTHER_PROJECT_COMMANDS: CHECK_GROUPS.README_COMMANDS,
  README_CHECK_SKIPPED: CHECK_GROUPS.README_COMMANDS,
  README_PACKAGE_MANAGER_MISMATCH: CHECK_GROUPS.README_COMMANDS,
  README_CI_COMMAND: CHECK_GROUPS.README_COMMANDS,
  README_CI_CHECK_SKIPPED: CHECK_GROUPS.README_COMMANDS,
  README_INSTALL_COMMAND: CHECK_GROUPS.README_COMMANDS,
  README_TEST_COMMAND: CHECK_GROUPS.README_COMMANDS,
  README_TEST_CHECK_SKIPPED: CHECK_GROUPS.README_COMMANDS,
  README_SCRIPT_REFERENCE: CHECK_GROUPS.README_COMMANDS,
  README_START_COMMAND_UNKNOWN: CHECK_GROUPS.README_COMMANDS,
  README_SCRIPT_UNKNOWN: CHECK_GROUPS.README_COMMANDS,
  README_SCRIPT_CHECK_SKIPPED: CHECK_GROUPS.README_COMMANDS,
  BUILD_OUTPUT_MISSING: CHECK_GROUPS.BUILD_OUTPUT,
  PRIVATE_REGISTRY: CHECK_GROUPS.PACKAGE_SOURCES,
  GIT_DEPENDENCIES: CHECK_GROUPS.PACKAGE_SOURCES,
  SERVICES_LIKELY_REQUIRED: CHECK_GROUPS.SERVICE_INDICATORS,
  ENV_CHECK_SKIPPED: CHECK_GROUPS.ENV_DOCUMENTATION,
  ENV_EXAMPLE_MISSING: CHECK_GROUPS.ENV_DOCUMENTATION,
  ENV_KEY_MISSING: CHECK_GROUPS.ENV_DOCUMENTATION,
  ENV_KEY_DOCUMENTED: CHECK_GROUPS.ENV_DOCUMENTATION,
  NVMRC_PRESENT: CHECK_GROUPS.NODE_RUNTIME,
  NVMRC_EMPTY: CHECK_GROUPS.NODE_RUNTIME,
  NVMRC_CHECK_SKIPPED: CHECK_GROUPS.NODE_RUNTIME,
  NODE_VERSION_PRESENT: CHECK_GROUPS.NODE_RUNTIME,
  NODE_VERSION_EMPTY: CHECK_GROUPS.NODE_RUNTIME,
  NODE_VERSION_CHECK_SKIPPED: CHECK_GROUPS.NODE_RUNTIME,
  ENGINES_NODE_PRESENT: CHECK_GROUPS.NODE_RUNTIME,
  DOCKER_NODE_BASE_PRESENT: CHECK_GROUPS.NODE_RUNTIME,
  RUNTIME_VERSION_MISMATCH: CHECK_GROUPS.NODE_RUNTIME,
  ENGINES_NODE_UNSATISFIED: CHECK_GROUPS.NODE_RUNTIME,
  DOCKER_NODE_CHECK_SKIPPED: CHECK_GROUPS.NODE_RUNTIME,

  // GitHub input and Docker verification are report boundaries/dynamic
  // operations rather than static check groups. Keep their public finding
  // codes explicit so consistency checks can distinguish them from an
  // accidentally omitted static mapping.
  GITHUB_URL_INVALID: null,
  GITHUB_REPOSITORY_UNAVAILABLE: null,
  GITHUB_REPOSITORY_TOO_LARGE: null,
  GITHUB_CHECKOUT_LIMIT_EXCEEDED: null,
  GITHUB_CHECKOUT_UNAVAILABLE: null,
  GITHUB_CLONE_FAILED: null,
  GITHUB_GIT_UNAVAILABLE: null,
  GITHUB_SOURCE_ERROR: null,
  DOCKER_EXECUTION_CONSENT_REQUIRED: null,
  DOCKER_PREREQUISITES_FAILED: null,
  DOCKER_NETWORK_REQUIRED: null,
  DOCKER_UNAVAILABLE: null,
  DOCKER_IMAGE_UNAVAILABLE: null,
  DOCKER_GITIGNORED_PATHS_SKIPPED: null,
  DOCKER_SENSITIVE_FILES_OMITTED: null,
  DOCKER_SYMLINKS_BLOCKED: null,
  DOCKER_CLEANUP_INCOMPLETE: null,
  DOCKER_VERIFICATION_PASSED: null,
  DOCKER_VERIFICATION_FAILED: null,
  VERIFY_NO_TESTS_RAN: null,
  DOCKER_STAGING_LIMIT_EXCEEDED: null,
  DOCKER_STAGING_SOURCE_CHANGED: null,
  DOCKER_VERIFICATION_ERROR: null
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

function assertCoverageConsistency(findings, coverage) {
  const checked = new Set(coverage && Array.isArray(coverage.checked) ? coverage.checked : []);
  const notChecked = new Set(coverage && Array.isArray(coverage.notChecked) ? coverage.notChecked : []);
  for (const id of checked) {
    if (notChecked.has(id)) throw new Error(`Coverage group is both checked and not checked: ${id}`);
  }
  for (const item of Array.isArray(findings) ? findings : []) {
    const group = FINDING_CHECK_GROUPS[item && item.code];
    if (group === undefined) throw new Error(`Finding code is not mapped to a coverage group: ${item && item.code}`);
    if (group === null) continue;
    if (notChecked.has(group)) throw new Error(`Finding ${item.code} belongs to a not-checked group: ${group}`);
  }
  return true;
}

module.exports = {
  CHECK_GROUPS,
  CHECK_GROUP_IDS,
  CHECK_GROUP_LABELS,
  FINDING_CHECK_GROUPS,
  NOT_CHECKED,
  NOT_CHECKED_LABELS,
  assertCoverageConsistency,
  createCoverage,
  createCoverageTracker
};
