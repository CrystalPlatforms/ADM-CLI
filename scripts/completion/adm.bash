# Bash completion for adm (v0.3 CLI surface — src/commands.js is the source of truth)
_adm_completion() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  local commands="help --help -h -v --version feedback config uninstall upgrade update dotfiles"

  # Top-level completion
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
    return 0
  fi

  case "${COMP_WORDS[1]}" in
    help|--help|-h|-v|--version|feedback|uninstall)
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "--json" -- ${cur}) )
      return 0
      ;;
    upgrade|update)
      COMPREPLY=( $(compgen -W "--check --dry-run" -- ${cur}) )
      return 0
      ;;
    dotfiles)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "sync" -- ${cur}) )
      else
        COMPREPLY=( $(compgen -W "--repo --copy --only" -- ${cur}) )
      fi
      return 0
      ;;
  esac
}
complete -F _adm_completion adm
