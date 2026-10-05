'use strict';
// Shared DevEco Studio installation resolver for the Node test runners.
//
// Keep the candidate list in sync with scripts/lib/deveco-env.sh; scripts/doctor.sh
// cross-checks that both resolvers agree on the same installation.
//
// Resolution order:
//   1. DEVECO_HOME, when it points at a usable installation
//   2. the platform defaults listed below
// The installation root is the directory that contains tools/ and sdk/;
// on macOS that is DevEco-Studio.app/Contents.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** @returns {string[]} Candidate installation roots, best first. */
function candidateHomes() {
  const candidates = [];
  if (process.env.DEVECO_HOME) candidates.push(process.env.DEVECO_HOME);
  if (process.platform === 'darwin') {
    candidates.push('/Applications/DevEco-Studio.app/Contents');
    candidates.push(path.join(os.homedir(), 'Applications/DevEco-Studio.app/Contents'));
  } else if (process.platform === 'win32') {
    candidates.push('D:/dev-tools/DevEco Studio');
    candidates.push('C:/Program Files/Huawei/DevEco Studio');
  } else {
    candidates.push(path.join(os.homedir(), 'DevEco-Studio'));
    candidates.push('/opt/deveco-studio');
  }
  return candidates;
}

/**
 * A usable installation has the hvigor toolchain and the bundled SDK.
 * @param {string} home
 * @returns {boolean}
 */
function isUsableHome(home) {
  if (!home || !fs.existsSync(home)) return false;
  return fs.existsSync(path.join(home, 'tools/hvigor')) && fs.existsSync(path.join(home, 'sdk'));
}

/**
 * Resolve the DevEco installation root.
 * @param {{ required?: boolean }} [options]
 * @returns {string} The first usable candidate, or '' when none is usable and not required.
 */
function resolveDevecoHome(options = {}) {
  const found = candidateHomes().find(isUsableHome);
  if (found) return found;
  const message =
    'Cannot locate a DevEco Studio installation. Set DEVECO_HOME to the directory that ' +
    'contains tools/ and sdk/ (macOS: /Applications/DevEco-Studio.app/Contents).\n' +
    'Tried:\n' +
    candidateHomes()
      .map((candidate) => '  - ' + candidate)
      .join('\n');
  if (options.required === false) return '';
  throw new Error(message);
}

/**
 * Load the TypeScript compiler bundled with DevEco.
 * The runners transpile production .ts/.ets sources in memory, so they must not
 * depend on a globally installed typescript.
 * @param {string} [home]
 * @returns {any}
 */
function loadTypescript(home = resolveDevecoHome()) {
  const modulePath = path.join(home, 'tools/hvigor/hvigor/node_modules/typescript');
  try {
    return require(modulePath);
  } catch (error) {
    throw new Error(`Cannot load the TypeScript compiler from ${modulePath}: ${error.message}`);
  }
}

module.exports = { candidateHomes, isUsableHome, resolveDevecoHome, loadTypescript };
