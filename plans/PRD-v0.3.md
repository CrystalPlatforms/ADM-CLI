# PRD: ADM v0.3.0 — lekki, wieloplatformowy instalator środowiska deweloperskiego

> Powstało w sesji /ask (2026-11-07). Komendy dziś: patrz `COMMANDS-LIST.txt` w repo.

## Problem Statement

ADM (v0.2.3) jest dziś ciężkim narzędziem TUI (React/ink) z modelem AI i integracjami GitHub/GitLab, które to wszystko trudno utrzymać, a głównej wartości — instalowania środowiska deweloperskiego na świeżym komputerze — nie dostarcza niezawodnie:

1. **Instalacja ADM wymaga Node.js** — a ADM ma być *pierwszym* CLI na nowej maszynie, którym instaluje się właśnie Node. Efekt: błędne koło na świeżym systemie.
2. **Instalacja narzędzi przez ADM pada na wielu systemach**: Linux ≠ tylko apt (Fedora, Arch, openSUSE, Alpine dostają złe komendy i złe nazwy paczek), przymusowy `/bin/bash`, `pip` zamiast `pip3`, adresy skryptów hardcoded pod macOS x86, PATH dopisywany do złego pliku rc (w bashu trafiamy do `.zshrc`). Użytkownik masowo widzi "skipped" i błędy.
3. **TUI na React/ink jest ciężkie, kruche na Windows i utrudnia utrzymanie.**
4. Funkcje AI/GitHub/GitLab rozmywają cel produktu i dodają ryzyko (tokeny, klucze, API).

## Solution

ADM v0.3.0 = **jedno lekkie narzędzie**: odpalasz `adm`, widzisz **wszystkie kategorie narzędzi naraz na jednym ekranie**, wybierasz kategorie, potem narzędzia, ADM instaluje je poprawnie dla **Twojego** systemu (dystrybucja, menedżer pakietów, architektura, powłoka) i pokazuje raport ✓/✗. ADM instaluje się **bez Node i npm** (paczka przenośna z własnym Node w `~/.adm/`) przez curl|sh / brew / PowerShell; kanał npm zostaje. Komendy: `adm help`, `adm upgrade|update`, `adm uninstall`, `adm feedback`, `adm config`, `adm dotfiles sync`, `adm -v`. Bez TUI, AI i integracji.

## User Stories

**Instalacja samego ADM**
1. Jako deweloper na świeżej maszynie Linux/macOS **bez Node**, chcę zainstalować ADM jedną komendą `curl … | sh`, żeby nie potrzebować niczego wcześniej.
2. Jako deweloper na świeżym Windowsie bez Node, chcę zainstalować ADM przez `irm … | iex` (PowerShell), żeby zacząć bez wstępnej konfiguracji.
3. Jako użytkownik Homebrew, chcę `brew install CrystalPlatforms/tap/adm`, żeby mieć ADM w znanym mi menedżerze.
4. Jako użytkownik npm, chcę `npm install -g @crystalplatforms/adm` dalej działać, żeby podbicie wymagań (Node ≥ 20) było jasno zakomunikowane przy błędzie.
5. Jako użytkownik, chcę żeby instalator nie używał `sudo` tam, gdzie nie musiał (instalacja do `~/.adm`, launcher do `~/.local/bin` / `%LOCALAPPDATA%`), żeby nie zaśmiecać systemu.

**Menu instalacji narzędzi**
6. Jako deweloper, chcę odpalić `adm` i zobaczyć **wszystkie kategorie naraz** (JS/TS, Python, Go, Rust, Java, .NET, Ruby, PHP, C/C++, Universal, AI) na jednym ekranie, żeby nic nie było schowane głębiej.
7. Jako deweloper, chcę zaznaczyć spacją kilka kategorii, potem konkretnych narzędzi, żeby jednym przejściem zainstalować całość dla mojego stacku.
8. Jako deweloper, chcę przy każdym narzędziu widzieć status (✓ już zainstalowane / do instalacji), żeby nie instalować podwójnie.
9. Jako deweloper, chcę raport po instalacji: ✓ zainstalowane / ✗ błąd **+ konkretna podpowiedź jak naprawić**, żeby wiedzieć co dalej bez zgadywania.
10. Jako nowicjusz, chcę żeby kreator (oprócz narzędzi) skonfigurował tylko gita (`user.name`, `user.email`), żeby git działał od razu, bez pytań o GPG/SSH.

**Naprawa detekcji i instalacji (rdzeń)**
11. Jako użytkownik Fedory/RHEL, Arch, openSUSE albo Alpine, chcę żeby ADM wykrył **mój menedżer pakietów** (dnf/pacman/zypper/apk) i użył **właściwych nazw paczek**, żeby instalacje przestały kończyć się błędami.
12. Jako użytkownik w bashu, chcę żeby PATH trafił do `.bashrc` (a w zsh do `.zshrc`) — detekcja **aktualnej** powłoki, nie powłoki logowania.
13. Jako użytkownik systemu bez `/bin/bash` (np. Alpine, NixOS), chcę żeby ADM używał POSIX `sh`, żeby w ogóle działał.
14. Jako użytkownik narzędzi Python, chcę instalację przez `pip3`/`python3 -m pip`, gdy `pip` nie istnieje, żeby przestać widzieć błędy komendy.
15. Jako użytkownik narzędzi "script" (conda, gcloud…), chcę poprawny adres skryptu dla mojego **systemu i architektury** (Linux/macOS × x64/ARM), żeby koniec z URL-em "macOS-x86" wszędzie.
16. Jako użytkownik npm-global, chcę naprawę uprawnień bez sudo (własny prefix npm + wpis w PATH + komunikat z gotową komendą przy EACCES), żeby instalacje npm-g nie wywalały się.
17. Jako użytkownik WSL, chcę żeby ADM wykrył WSL i zachował się jak Linux, żeby instalacje działały.
18. Jako użytkownik Maca z Apple Silicon lub Linuksa ARM64, chcę wsparcie ARM, żeby instalacje script/binary trafiały we właściwe pliki.

**Komendy**
19. Jako użytkownik, chcę `adm help` z listą wszystkich komend, żeby pamiętać co ADM umie.
20. Jako użytkownik, chcę `adm upgrade` (alias `adm update`) podmieniający **całą paczkę przenośną** (kod + prywatny Node) na nową wersję, żeby aktualizować się bez npm.
21. Jako użytkownik, chcę `adm uninstall` usuwający `~/.adm` i launcher, żeby sprzątnąć bez śladu.
22. Jako użytkownik, chcę `adm dotfiles sync` dalej działać, żeby przywracać konfigurację powłoki z repo.
23. Jako użytkownik, chcę `adm feedback`, `adm config`, `adm -v`, żeby kontakt/pregląd/wersja były pod ręką.

**Migracja i porządki**
24. Jako użytkownik starej wersji, chcę żeby przy pierwszym starcie v0.3.0 stare tokeny GitHub/GitLab i cache AI zostały **usunięte z komunikatem**, żeby moje sekrety nie leżały niepotrzebnie na dysku.
25. Jako deweloper ADM, chcę macierz CI (ubuntu + macOS + Windows) testującą instalację po każdym pushu, żeby regresje instalacji łapać przed wydaniem, nie u użytkowników.

## Implementation Decisions

**Składniki (głębokie moduły — wąski interfejs, dużo logiki w środku):**
1. **platform** — `detectEnvironment()`: OS, dystrybucja (parsowanie /etc/os-release), menedżer pakietów, architektura, WSL, aktualna powłoka (łańcuch procesów + `$0`, fallback `$SHELL`).
2. **pkg** — abstrakcja menedżera pakietów (brew/apt/dnf/pacman/zypper/apk/winget/choco/scoop) + **tabela nazw paczek per dystrybucja** dla narzędzi z katalogu.
3. **installer** — orkiestrator: metody nvm/npm/node/pip(pip3)/cargo/go/gem/composer/dotnet/script/brew/apt/… + URL-e skryptów per OS/arch + naprawa prefixu npm + odświeżanie PATH po instalacji.
4. **shell-paths** — wykrywanie aktualnej powłoki, idempotentny zapis do właściwego rc (znacznik, sprzątanie duplikatów).
5. **wizard** — przepływ inquirer: kategorie (checkbox, wszystkie naraz) → narzędzia (checkbox ze statusem) → instalacja (spinner, raport ✓/✗+hint) → krok gita (name/email).
6. **self-update** — pobranie paczki z GitHub Releases, weryfikacja sumy kontrolnej, podmiana `~/.adm/app` + runtime; `adm upgrade` go używa.
7. **legacy-cleanup + config** — usunięcie tokenów/kluczy w keychainie i cache AI przy pierwszym starcie (+ komunikat); config.json uproszczony.
8. **bootstrap** — `installer.sh`, `install.ps1`, formuła Homebrew: pobranie paczki (~40–60 MB), rozpakowanie do `~/.adm`, launcher `adm` bez sudo.
9. **CI** — macierz GH Actions: ubuntu/macos/windows × (instalacja npm; smoke curl|sh na unix; smoke PS na Windows); budowa paczek przy tagu → GitHub Releases.

**Granice i przepływy:** `adm` → platform → wizard (pytania) → installer (pkg lub metoda) → shell-paths → raport. Wizard jest **jedynym** miejscem rozmowy z użytkownikiem; składniki 1–4 i 6 są interaktywnie-neutralne (da się je testować i używać bez terminala).

**Paczka przenośna:** `~/.adm/runtime` (własny Node) + `~/.adm/app` (kod) + launcher na PATH; konflikt z systemowym Node wykluczony przez priorytet ścieżek tylko wewnątrz procesów ADM.

**Zależności:** zostają `chalk`, `inquirer`, `ora`; wyrzucone: `ink`, `react`, `react-dom`, `@octokit/rest`, `commander`, `execa` (+ moduły keychain/token-encryption/AI). `engines: >=20` (dotyczy tylko kanału npm).

**Wersjonowanie:** v0.3.0 (ta przebudowa), v0.4.0 (zarządzanie narzędziami + doctor). Katalog 280 narzędzi bez zmian.

## Assumptions

- **GitHub Releases** nadaje się na hosting paczek (~40–60 MB × 5 platform) i jest dostępny w sieciach docelowych.
- **inquirer/chalk/ora działają poprawnie** pod prywatnym Node w paczce przenośnej (brak ink = brak ryzyka TUI).
- Użytkownik **akceptuje pobranie ~40–60 MB** przy instalacji.
- Prywatny Node w `~/.adm` **nie koliduje** z systemowym (osobne wpisy PATH tylko wewnątrz procesu ADM).
- Zmiana przełomowa (usunięcie /ai, /github, /gitlab, /theme, /connect) jest **OK dla istniejących użytkowników** (0.x).
- Pięć menedżerów pakietów (apt/dnf/pacman/zypper/apk) + brew + winget/choco/scoop **pokrywa praktycznie wszystkich** docelowych użytkowników; reszta dostaje czytelną instrukcję ręczną.
- Tabela nazw paczek wymaga **utrzymania ręcznego** przy zmianach katalogu — akceptujemy ten koszt.
- PowerShell 5.1+ jest dostępny domyślnie na Windows (jest).
- Formuła Homebrew (tap CrystalPlatforms) będzie wskazywać paczkę przenośną z Releases.

## Tradeoffs Considered

- **Jeden plik binarny (bun compile / Node SEA)** — odrzucone: większe ryzyko kompatybilności z zależnościami CommonJS, budowa 5 binarek, dłuższy czas implementacji.
- **Bootstrap: najpierw prywatny Node, potem `npm install` ADM** — odrzucone: dwa kroki i dłuższa instalacja, mniej deterministyczne niż gotowa paczka.
- **Przepisanie na Go/Rust** — odrzucone: pełna utrata istniejącego kodu JS i tygodnie pracy dla tej samej funkcjonalności.
- **Zostawienie TUI (ink/React)** — odrzucone: ciężkie, kruche na Windows, wbrew celowi produktu.
- **Zostawienie AI / GitHub / GitLab** — odrzucone przez właściciela: rozmywanie celu produktu i powierzchnia ryzyka (tokeny).
- **`adm doctor` w 0.3.0** — przesunięte do v0.4.0 decyzją właściciela.
- **Zero zależności (czysty Node)** — odrzucone: chalk/inquirer/ora są sprawdzone, a własne implementacje promptów = więcej ryzyka niż korzyści.
- **Linux apt-only (status quo)** — odrzucone: główne źródło masowych "skipped/błąd" zgłaszanych przez właściciela.
- **Pytanie o GPG i generowanie SSH w kreatorze** — odrzucone: uproszczenie dla nowicjuszy (decyzja właściciela).

## Validation Strategy

**Nacisk: instalacja + detekcja (decyzja właściciela).**

**Detekcja środowiska (platform):**
- Testy jednostkowe na fixturach: pliki /etc/os-release dla Ubuntu/Fedora/Arch/openSUSE/Alpine → poprawny menedżer; env WSL; architektury x64/ARM; drzewa procesów → bash vs zsh.
- **Kompletność tabeli nazw paczek:** test iterujący katalog (280 narzędzi) × wspierane dystrybucje — zero narzędzi bez mapowania lub jawnego powodu "manual" (próg: 0 wyjątków na wspieranych platformach).

**Instalacja narzędzi (installer/pkg):**
- Testy `ADM_DRY_RUN=1`: dla **każdej** metody (nvm/npm/pip3/cargo/go/gem/composer/dotnet/script/brew/apt/dnf/pacman/zypper/apk/winget/choco/scoop) plan instalacji generuje poprawną komendę dla danej platformy.
- Testy rozwiązywania URL-i skryptów per OS/arch (conda: linux-x64/linux-arm64/macos-x64/macos-arm64).
- Testy writer-a rc: bash→`.bashrc`, zsh→`.zshrc`; idempotencja (podwójne uruchomienie = brak duplikatów); sprzątanie starych znaczników.
- Test fallbacku pip→pip3 i naprawy prefixu npm (symulacja EACCES).

**Smoke CI (matryca):** ubuntu-latest/macos-latest/windows-latest: `npm install` → `adm -v` wypisuje wersję; dodatkowo curl|sh na unix i install.ps1 na Windows; `adm dotfiles sync --help` i `adm config` nie padają.

**Kryteria "done" per składnik:**
- platform: rozpoznaje dystrybucję/menedżera na wszystkich obrazach CI + fixture-testy zielone.
- pkg/installer: pełne pokrycie metod × platform w dry-run; na CI (natywnie) przynajmniej 1 realna instalacja na system.
- wizard: symulowany test TTY — przepływ kategorie→narzędzia→raport przechodzi; raport pokazuje ✓/✗+hint.
- self-update: test podmiany na fikcyjnej paczce (starsza → nowsza wersja) w katalogu tymczasowym; `adm -v` po podmianie pokazuje nowy numer.
- bootstrap: skrypt na czystym kontenerze CI (bez Node) → `adm -v` działa.
- legacy-cleanup: fixture `~/.adm` z tokenami → po pierwszym starcie pliki usunięte + komunikat na wyjściu.

**HITL (instrukcje testów ręcznych po implementacji):** świeża maszyna/kontener bez Node → instalacja curl|sh → `adm` → instalacja 2–3 narzędzi z różnych kategorii → `adm upgrade` → `adm uninstall`; na Windows analogicznie przez PowerShell.

## Out of Scope

- `adm doctor` — **v0.4.0** (decyzja właściciela).
- Zarządzanie narzędziami (update/uninstall narzędzi, `adm install <nazwa>`, `--json`) — **v0.4.0**.
- AI, integracje GitHub/GitLab, motywy, pluginy — usunięte **trwale**, nie wracają.
- Generowanie kluczy SSH w kreatorze — wycięte.
- Nix/macPorts/guix jako docelowe menedżery — tylko czytelna instrukcja ręczna.
- Telemetria — nie istnieje i nie powstanie.

## Further Notes

- Numery wersji: ta przebudowa = **0.3.0**; zarządzanie narzędziami + doctor = **0.4.0**.
- Pełna lista decyzji z sesji /ask: `COMMANDS-LIST.txt` w katalogu repo.
- Produkty nie ma telemetrii ani żadnych zewnętrznych API poza pobieraniem paczek z GitHub Releases.
