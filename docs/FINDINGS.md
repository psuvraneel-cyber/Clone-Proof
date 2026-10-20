# Finding-code reference

CloneProof reports stable machine-readable finding codes in `report.findings[]`.
The code is the contract; titles, messages, evidence, and recommendations make
the result useful to people without changing the code's meaning. A code may be
absent when its condition does not apply to a repository or when the relevant
check was safely blocked before it could run.

The source-emission meta-test in `test/finding-codes.test.js` requires every
literal finding code emitted from `src/` to have a test reference and to appear
in this document.

## Status definitions

Finding statuses describe the result of one check:

| Status | Meaning |
|---|---|
| `passed` | The check observed the expected condition. It is evidence, not a guarantee that the whole repository is reproducible. |
| `warning` | The check found a review-worthy condition, but it does not by itself block the static result. |
| `skipped` | The check was intentionally not performed, usually because it is outside the current scope, depends on unavailable metadata, or was safely omitted. |
| `failed` | The check found a blocking repository problem or an execution/cleanup error. |

Report-level statuses are separate from finding statuses:

| Report status | Meaning |
|---|---|
| `passed` | The attempted checks completed without blocking findings. |
| `passed_with_warnings` | The attempted checks completed with warnings. |
| `failed` | A blocking check, controlled verification, zero-test result, or cleanup operation failed. |
| `blocked` | CloneProof intentionally did not continue, for example because consent, Docker, network consent, staging policy, or target support was missing. |
| `incomplete` | A required root, file, clone, or bounded scan operation could not be inspected completely. |

## Severity definitions

Severity describes how a finding should be triaged; it does not replace the
status field.

| Severity | Meaning |
|---|---|
| `info` | Evidence or an explicit scope boundary. Review it for context, but it is not a failure signal by itself. |
| `warning` | A likely reproducibility or verification concern that needs review. It normally permits a passed-with-warnings result. |
| `error` | A blocking setup, repository, execution, or cleanup problem. It normally contributes to a failed result. |

## Check-group mappings

Static findings map to one of these stable `report.coverage.checked` groups.
`report.coverage.notChecked` contains the fixed scope exclusions documented in
the README. Dynamic input and Docker-boundary findings use the `Boundary /
dynamic` label instead of pretending to be a static project check.

| Coverage ID | Check group |
|---|---|
| `package-manifest` | Package manifest |
| `lockfile-presence-validity-sync` | Lockfile presence, validity, and synchronization |
| `package-manager-consistency` | Package-manager consistency |
| `test-script` | Test script |
| `readme-npm-commands` | README npm commands |
| `env-documentation` | Environment documentation |
| `node-runtime-declarations` | Node runtime declarations |
| `gitignored-core-files` | Gitignored core files |
| `install-scripts` | Install scripts intentionally skipped by Docker verification |
| `browser-tests` | Browser tests detected in the npm workflow |
| `nested-packages` | Nested package boundaries |
| `project-classification` | Project classification |
| `package-sources` | Package registries and Git dependency hosts |
| `build-output` | Declared build output files |
| `service-indicators` | Compose files and service dependency indicators |

## Finding-code reference

The mapping below covers the stable codes currently emitted by `src/`. Codes
describing `cloneproof setup` are setup-result codes rather than entries in a
schema-v2 report's `findings[]`; they are listed so callers can handle setup
without guessing.

### Static scan findings

| Code | Check group or boundary |
|---|---|
| `BROWSER_TESTS_DETECTED` | Browser tests |
| `BUILD_OUTPUT_MISSING` | Declared build output files |
| `CORE_FILE_GITIGNORED` | Gitignored core files |
| `EMPTY_REPOSITORY` | Project classification |
| `ENGINES_NODE_PRESENT` | Node runtime declarations |
| `ENGINES_NODE_UNSATISFIED` | Node runtime declarations |
| `ENV_CHECK_SKIPPED` | Environment documentation |
| `ENV_EXAMPLE_MISSING` | Environment documentation |
| `ENV_KEY_DOCUMENTED` | Environment documentation |
| `ENV_KEY_MISSING` | Environment documentation |
| `GIT_DEPENDENCIES` | Package registries and Git dependency hosts |
| `GIT_METADATA_REQUIRED` | Test script |
| `INSTALL_SCRIPTS_SKIPPED` | Install scripts |
| `LOCKFILE_INVALID` | Lockfile presence, validity, and synchronization |
| `LOCKFILE_MISSING` | Lockfile presence, validity, and synchronization |
| `LOCKFILE_OUT_OF_SYNC` | Lockfile presence, validity, and synchronization |
| `LOCKFILE_PRESENT` | Lockfile presence, validity, and synchronization |
| `MULTIPLE_LOCKFILES` | Lockfile presence, validity, and synchronization |
| `NESTED_PACKAGES_SKIPPED` | Nested packages |
| `NODE_VERSION_CHECK_SKIPPED` | Node runtime declarations |
| `NODE_VERSION_EMPTY` | Node runtime declarations |
| `NODE_VERSION_PRESENT` | Node runtime declarations |
| `NVMRC_CHECK_SKIPPED` | Node runtime declarations |
| `NVMRC_EMPTY` | Node runtime declarations |
| `NVMRC_PRESENT` | Node runtime declarations |
| `PACKAGE_JSON_INVALID` | Package manifest |
| `PACKAGE_JSON_MISSING` | Package manifest |
| `PACKAGE_JSON_PRESENT` | Package manifest |
| `PACKAGE_JSON_UNSCANNED` | Package manifest |
| `PACKAGE_MANAGER_LOCKFILE_MISMATCH` | Package-manager consistency |
| `PACKAGE_MANAGER_UNRECOGNIZED` | Package-manager consistency |
| `PRIVATE_REGISTRY` | Package registries and Git dependency hosts |
| `README_CHECK_SKIPPED` | README npm commands |
| `README_CI_CHECK_SKIPPED` | README npm commands |
| `README_CI_COMMAND` | README npm commands |
| `README_INSTALL_COMMAND` | README npm commands |
| `README_OTHER_PROJECT_COMMANDS` | README npm commands |
| `README_PACKAGE_MANAGER_MISMATCH` | README npm commands |
| `README_SCRIPT_CHECK_SKIPPED` | README npm commands |
| `README_SCRIPT_REFERENCE` | README npm commands |
| `README_SCRIPT_UNKNOWN` | README npm commands |
| `README_START_COMMAND_UNKNOWN` | README npm commands |
| `README_TEST_CHECK_SKIPPED` | README npm commands |
| `README_TEST_COMMAND` | README npm commands |
| `RUNTIME_VERSION_MISMATCH` | Node runtime declarations |
| `SCAN_ENTRY_LIMIT_EXCEEDED` | Boundary / dynamic |
| `SCAN_ROOT_UNAVAILABLE` | Boundary / dynamic |
| `SERVICES_LIKELY_REQUIRED` | Compose files and service dependency indicators |
| `TEST_FILES_FOUND` | Project classification |
| `TEST_SCRIPT_CHECK_SKIPPED` | Test script |
| `TEST_SCRIPT_PLACEHOLDER` | Test script |
| `TEST_SCRIPT_PRESENT` | Test script |
| `UNSUPPORTED_ROOT` | Project classification |

### GitHub input and Docker verification findings

| Code | Check group or boundary |
|---|---|
| `DOCKER_CLEANUP_INCOMPLETE` | Boundary / dynamic |
| `DOCKER_EXECUTION_CONSENT_REQUIRED` | Boundary / dynamic |
| `DOCKER_GITIGNORED_PATHS_SKIPPED` | Boundary / dynamic |
| `DOCKER_IMAGE_UNAVAILABLE` | Boundary / dynamic |
| `DOCKER_NETWORK_REQUIRED` | Boundary / dynamic |
| `DOCKER_NODE_BASE_PRESENT` | Node runtime declarations |
| `DOCKER_NODE_CHECK_SKIPPED` | Node runtime declarations |
| `DOCKER_PREREQUISITES_FAILED` | Boundary / dynamic |
| `DOCKER_SENSITIVE_FILES_OMITTED` | Boundary / dynamic |
| `DOCKER_STAGING_LIMIT_EXCEEDED` | Boundary / dynamic |
| `DOCKER_STAGING_SOURCE_CHANGED` | Boundary / dynamic |
| `DOCKER_SYMLINKS_BLOCKED` | Boundary / dynamic |
| `DOCKER_UNAVAILABLE` | Boundary / dynamic |
| `DOCKER_VERIFICATION_ERROR` | Boundary / dynamic |
| `DOCKER_VERIFICATION_FAILED` | Boundary / dynamic |
| `DOCKER_VERIFICATION_PASSED` | Boundary / dynamic |
| `GITHUB_CHECKOUT_UNAVAILABLE` | Boundary / dynamic |
| `GITHUB_CLONE_FAILED` | Boundary / dynamic |
| `GITHUB_GIT_UNAVAILABLE` | Boundary / dynamic |
| `GITHUB_URL_INVALID` | Boundary / dynamic |
| `VERIFY_NO_TESTS_RAN` | Boundary / dynamic |

### Docker setup result codes

These are returned by `cloneproof setup` as the result's `code`; they are not
static findings and are not added to `report.findings[]`.

| Code | Meaning |
|---|---|
| `DOCKER_IMAGE_ALREADY_PRESENT` | The exact pinned verifier image was already available locally. |
| `DOCKER_IMAGE_READY` | The image was pulled and then confirmed by a second inspect. |
| `DOCKER_PULL_FAILED` | Pulling the exact pinned image failed. |
| `DOCKER_SETUP_FAILED` | Setup raised an unexpected error while preparing the Docker CLI configuration or probing the image. |

## High-risk codes

- `VERIFY_NO_TESTS_RAN` is a failed verification even when the container exits
  `0`; a successful process that discovers no tests proves nothing about the
  test suite.
- `DOCKER_EXECUTION_CONSENT_REQUIRED` means no target code was executed. The
  caller must explicitly authorize the controlled Docker workflow.
- `DOCKER_NETWORK_REQUIRED` means network access was needed but was not
  authorized; rerun only after reviewing the repository and choosing
  `--allow-network`.
- `GITHUB_CLONE_FAILED`, `GITHUB_CHECKOUT_UNAVAILABLE`, and the staging-limit
  findings describe bounded input/cleanup boundaries. Their evidence is
  sanitized and limited before it enters a report.
- `DOCKER_CLEANUP_INCOMPLETE` and `DOCKER_STAGING_SOURCE_CHANGED` mean the
  verification result should not be treated as a clean reproducibility proof.

When adding a new finding code, add its coverage mapping (when it is a static
finding), a regression test, and a row here. Do not reuse a code for a new
meaning; reports are consumed by scripts as well as people.
