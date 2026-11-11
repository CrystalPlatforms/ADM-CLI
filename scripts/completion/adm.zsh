#compdef adm
# v0.3 CLI surface — src/commands.js is the source of truth

_adm() {
  local -a commands

  commands=(
    'help:Show available commands'
    '-v:Print ADM version'
    'feedback:Show how to report bugs and ideas'
    'config:Show ADM config and detected environment'
    'uninstall:Remove ADM data (~/.adm) and shell PATH entries'
    'upgrade:Self-update ADM (alias: update)'
    'dotfiles:Sync dotfiles from a git repo'
  )

  _arguments -C \
    '1:command:->command' \
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        config)
          _arguments '--json[Machine-readable output]'
          ;;
        upgrade|update)
          _arguments \
            '--check[Only check whether a newer version exists]' \
            '--dry-run[Print the upgrade plan without changing anything]'
          ;;
        dotfiles)
          local -a dotfiles_subs
          dotfiles_subs=('sync:Sync dotfiles from a git repo into your home dir')
          if (( CURRENT == 2 )); then
            _describe 'subcommand' dotfiles_subs
          else
            _arguments \
              '--repo[Dotfiles git repo URL]:url:' \
              '--copy[Copy files instead of symlinking]' \
              '--only[Comma-separated file list]:names:'
          fi
          ;;
      esac
      ;;
  esac
}

_adm "$@"
