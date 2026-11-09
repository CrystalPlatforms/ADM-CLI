const REPO_ISSUES = 'https://github.com/CrystalPlatforms/ADM-CLI/issues';

function runFeedback({ log } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  log('Found a bug or an idea? Open an issue:');
  log(`  ${REPO_ISSUES}`);
  log('');
  log('Include: OS + distro, shell, the command you ran, and the full output.');
  return 0;
}

module.exports = { runFeedback, REPO_ISSUES };
