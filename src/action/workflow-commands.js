'use strict';

/**
 * Escapes property values for GitHub Actions workflow commands.
 * Property values require percent-encoding of '%', '\r', '\n', ':', and ','.
 * Note: '%' MUST be replaced first to avoid double-encoding.
 */
function escapeWorkflowProperty(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

/**
 * Escapes message data for GitHub Actions workflow commands.
 * Message data requires percent-encoding of '%', '\r', and '\n'.
 * Note: '%' MUST be replaced first to avoid double-encoding.
 */
function escapeWorkflowMessage(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

/**
 * Formats a single GitHub Actions workflow command line.
 * Syntax: ::command [key=val,key=val]::message
 *
 * Example:
 * ::error file=packages/backend/src/server.js,title=TEST_SCRIPT_MISSING::The repository does not define the expected test script.
 */
function formatWorkflowCommand(command, properties = {}, message = '') {
  if (typeof command !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(command)) {
    throw new Error(`Invalid workflow command name: ${command}`);
  }

  const propTokens = [];
  for (const [key, val] of Object.entries(properties)) {
    if (val !== undefined && val !== null && val !== '') {
      propTokens.push(`${key}=${escapeWorkflowProperty(val)}`);
    }
  }

  const propString = propTokens.length > 0 ? ` ${propTokens.join(',')}` : '';
  return `::${command}${propString}::${escapeWorkflowMessage(message)}`;
}

module.exports = {
  escapeWorkflowMessage,
  escapeWorkflowProperty,
  formatWorkflowCommand
};
