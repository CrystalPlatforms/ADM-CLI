// ── Single source of truth for the CLI surface (frozen contract) ──
// Exit codes: 0 = success (incl. "nothing to do")
//             1 = usage error (message enumerates the valid set)
//             2 = execution failure
const COMMANDS = [
  { name: 'help', aliases: ['--help', '-h'], summary: 'Show available commands' },
  { name: '-v', aliases: ['--version'], summary: 'Print ADM version' },
  { name: 'feedback', summary: 'Show how to report bugs and ideas' },
  { name: 'config', summary: 'Show ADM config and detected environment', flags: ['--json'] },
  { name: 'uninstall', summary: 'Remove ADM data (~/.adm) and shell PATH entries' },
  { name: 'tools', summary: 'Browse installed tools in a full-screen list' },
  { name: 'upgrade', aliases: ['update'], summary: 'Self-update ADM (bundle: atomic swap · npm: prints the npm command)',
    flags: ['--check', '--dry-run'] },
  { name: 'dotfiles sync', summary: 'Sync dotfiles from a git repo into your home dir',
    usage: 'adm dotfiles sync [--repo <url>] [--copy] [--only <name,name>]' },
];

const AUTOMATION_HINTS = [
  'Automation:',
  '  ADM_TOOLS=<id,id> adm               install the given tools (no prompts)',
  '  ADM_DRY_RUN=1 ADM_TOOLS=<ids> adm   print the install plan only (no changes)',
  ...(process.platform === 'win32' ? [
    '  PowerShell:  $env:ADM_TOOLS="typescript,node"; adm   (then: $env:ADM_TOOLS=$null)',
  ] : []),
];

module.exports = { COMMANDS, AUTOMATION_HINTS };
