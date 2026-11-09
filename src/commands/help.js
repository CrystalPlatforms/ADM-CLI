const { COMMANDS, AUTOMATION_HINTS } = require('../commands');

// Renders one "  <name>  <summary>" line per COMMANDS table entry.
// This is the only place help text is produced — the table is the single
// source of truth (anti-drift).
function renderCommandLines() {
  const width = Math.max(...COMMANDS.map(c => c.name.length));
  const flagsWidth = Math.max(...COMMANDS.map(c => c.flags ? c.flags.join('|').length : 0));
  const labelWidth = width + (flagsWidth > 0 ? flagsWidth + 3 : 0);
  return COMMANDS.map(c => {
    const flags = c.flags ? ` [${c.flags.join('|')}]` : '';
    return `  ${(c.name + flags).padEnd(labelWidth)}  ${c.summary}`;
  });
}

function showHelp() {
  const lines = [
    'ADM — lightweight, multi-platform developer environment installer',
    '',
    'Usage:',
    '  adm <command> [flags]',
    '',
    'Commands:',
    ...renderCommandLines(),
    '',
    ...AUTOMATION_HINTS,
    '',
    'Docs: https://github.com/CrystalPlatforms/ADM-CLI#readme',
  ];
  return lines.join('\n');
}

module.exports = { showHelp, renderCommandLines };
