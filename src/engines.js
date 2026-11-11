// Node-version gate (#33): the only module bin/adm may require on OLD Node.
// bin/adm itself and this file stay old-Node-parseable (no optional chaining,
// no ??) — src/ elsewhere is allowed modern syntax because this check runs
// BEFORE any other require, turning an opaque SyntaxError into a friendly,
// enumerated fix list (story 4), exit 1.

var NODE_MAJOR_MIN = 20;
var NPM_PACKAGE = '@crystalplatforms/adm';
var REPO = 'CrystalPlatforms/ADM-CLI';

function nodeCheck(versions, majorMin) {
  var min = majorMin || NODE_MAJOR_MIN;
  var v = (versions && versions.node) || '0';
  var major = Number(String(v).split('.')[0]);
  var ok = major >= min;
  var message = '';
  if (!ok) {
    var lines = [
      '',
      'ADM needs Node.js ' + min + ' or newer (you have v' + v + ').',
      '',
      'Fix it any of these ways:',
      '  1. Install the Node.js LTS from https://nodejs.org',
      '  2. nvm:      nvm install ' + min + ' && nvm use ' + min,
      '  3. fnm:      fnm install ' + min + ' && fnm use ' + min,
      '  4. Windows:  winget install OpenJS.NodeJS.LTS',
      '',
      'Or skip Node entirely — install the portable bundle (recommended):',
      '  macOS / Linux:  curl -fsSL https://raw.githubusercontent.com/' + REPO + '/main/scripts/installer.sh | sh',
      '  Windows:        irm https://raw.githubusercontent.com/' + REPO + '/main/scripts/install.ps1 | iex',
      '',
    ];
    message = lines.join('\n') + '\n';
  }
  return { ok: ok, version: v, major: major, min: min, message: message };
}

module.exports = { nodeCheck, NODE_MAJOR_MIN, NPM_PACKAGE };
