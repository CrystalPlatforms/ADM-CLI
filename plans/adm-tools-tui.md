# Plan: `adm tools` — pełnoekranowe TUI zarządzania narzędziami (v0.4.0)

> Źródło: `plans/PRD-v0.4.md` (sesja /ask 2026-11-07) + decyzje sesji /carve (2026-11-12).
> Sprostowanie względem issue #25: `adm doctor` **nie** wchodzi do v0.4 — trafia do **v0.5.0** (`plans/PRD-v0.5.md`). Właściciel potwierdził przy /carve.

## Architectural decisions

Decyzje trwałe, obowiązujące we wszystkich fazach:

- **Architektura:** ekran TUI (ink) jest wyłącznie „skórką". Moduły **inventory / tool-info / tool-actions** są neutralne terminalowo (bez ink) — testowalne na fixturach i mockowanym exec. ink jest używany wyłącznie przez tools-tui; reszta paczki bez ink.
- **Model danych:** `ToolEntry { id, name, version?, binPath?, source: adm|npm|brew|pip|cargo|go|system|other, manager?, method?, installedAt? }`.
- **Inventory scala 3 źródła:** wykrycie katalogu (v0.3) + listy menedżerów + rejestr `~/.adm/installed.json` (moduł rejestru istnieje z v0.3). Priorytet atrybucji: **rejestr > menedżer > katalog**; duplikaty scalone do 1 wpisu.
- **Grupy (8, stałe):** ADM / npm / brew / pip / cargo / go / system / poza menedżerem. **Decyzja /carve:** parsery odczytu winget/choco/scoop trafiają do grupy „system" (istotne na Windows).
- **Odporność:** parser wersjonowany per menedżer; porażka parsowania lub brak menedżera = **pusta grupa + wiersz ostrzeżenia, nigdy crash**.
- **Leniwość:** skan lekki, równoległy, ze zdarzeniami postępu; rozmiar na dysku i config/cache/docs liczone **dopiero przy zaznaczeniu** (tool-info), nie w skanie.
- **Flagi możliwości:** `canUpdate / canRemove / hasCache / canReveal` — jedyne źródło prawdy o wygaszaniu akcji.
- **Sterowanie (wyłącznie klawiatura, napisy EN):** ↑↓ nawigacja; Enter/Spacja zwijanie/rozwijanie grupy; **u** = aktualizuj; **r** = usuń; **f** = reveal folderu; **c** = reveal cache; **F5 lub Shift+R = rescan** (decyzja /carve: małe **r** nie robi rescanu — rozstrzygnięty konflikt z PRD); **q** = wyjście.
- **Reveal per OS:** `open -R` (macOS), `explorer /select,` (Windows), `xdg-open` (Linux).
- **Terminal:** ≥ ~80×24; mniejszy → ekran z komunikatem minimalnego rozmiaru, nie próba rysowania.

---

## Phase 1: Tracer bullet — `adm tools` wstaje end-to-end

**User stories**: 1, 2*, 3*, 6, 7*, 18*, 20 (pełne pokrycie 2/3/7/18 w fazach 2–5)

### What to build

`adm tools` otwiera pełnoekranowe TUI: ekran skanu z loaderem dots_12 (reuse istniejących klatek) i licznikiem postępu („scanning 45/280…"), po zakończeniu — lista narzędzi pogrupowana wg źródła. Tracer już zawiera **wszystkie 3 źródła inventory** (rejestr + npm global + wykrycie katalogu v0.3), więc architektura scalania wchodzi od pierwszego plasterka. ↑↓ zmienia zaznaczenie, q wychodzi. Brak menedżera = pusta grupa + wiersz ostrzeżenia.

### Assumptions carried in

- Moduły v0.3.0 działają: rejestr `installed.json`, klatki dots_12 (już osadzone w kodzie z atrybucją), platform, catalog.
- ink wraca do `package.json` — wyłącznie na potrzeby tego ekranu.
- `loader.txt` z roota repo jest usuwany w tej fazie (atrybucja zostaje w kodzie).

### Out of scope for this phase

- Pozostali menedżerowie (brew/pip/cargo/go/system/winget/choco/scoop) — faza 2.
- Panel boczny, akcje, reveal, ekran minimalnego rozmiaru — fazy 3–5.

### Acceptance criteria

- [ ] Inventory scala 3 źródła na fixturach (rejestr + `npm ls -g --json` + wykrycie katalogu); ta sama pozycja w ≥2 źródłach = **1 scalony wpis**, priorytet rejestr > menedżer > katalog — [test: inventory na fixturach]
- [ ] Brak npm i brak rejestru → puste grupy + wiersze ostrzeżenia, TUI wstaje bez crashu — [test: render przez ink-testing-library]
- [ ] Ekran skanu animuje klatki dots_12 z licznikiem postępu; po zakończeniu skanu lista zastępuje skan — [test: ink-testing-library]
- [ ] ↑↓ zmienia zaznaczenie; q kończy proces z kodem 0 — [test] + [command: `node ./bin/adm tools` otwiera i zamyka się czysto]
- [ ] `loader.txt` nie istnieje w repo — [observable: brak pliku, atrybucja w kodzie]

---

## Phase 2: Pełny skan — wszyscy menedżerowie, scalanie, zwijanie, rescan

**User stories**: 2, 3, 4, 5, 7, 8 (+18 częściowo)

### What to build

Parsery odczytu dla wszystkich menedżerów: brew (`brew list --json`), pip (`pip3 list --format=json`), cargo (`cargo install --list`), go (skan `~/go/bin`), systemowe Linuksa (dpkg-query / rpm -qa / pacman -Q / zypper / apk) oraz — decyzja /carve — **winget / choco / scoop** (grupa „system" na Windows). Skan równoległy ze zdarzeniami postępu; pełne scalanie z atrybucją i priorytetem źródeł. Zwijanie/rozwijanie grup klawiaturą (Enter/Spacja na nagłówku). Rescan: **F5 lub Shift+R** (pełny, ręczny).

### Assumptions carried in

- Faza 1: szkielet TUI + 3-źródłowe inventory + loader działają.
- Formaty wyjść menedżerów bywają zmienne między wersjami — każdy parser jest wersjonowany; porażka = pusta grupa + ostrzeżenie.

### Out of scope for this phase

- Panel boczny i pomiar rozmiaru — faza 3.
- Akcje u/r/f/c — fazy 4–5.

### Acceptance criteria

- [ ] Każdy z 12 parserów zwraca poprawnie sparsowane wpisy (nazwa, wersja, ścieżka o ile menedżer ją podaje) na realnych fragmentach wyjść — [test: fixtures brew / npm / pip / cargo / go / dpkg / rpm / pacman / zypper / apk / winget / choco / scoop]
- [ ] Scalanie: ≥5 kolizji (katalog + menedżer + rejestr) → po 1 wpisie, priorytet zachowany — [test]
- [ ] Odporność: zepsuty JSON / brak menedżera — dla każdej z 8 grup → pusta grupa + ostrzeżenie, zero crashy — [test × 8]
- [ ] Wydajność: 280 pozycji katalogu + fixtury menedżerów, mockowany exec → pełny skan < 5 s; zdarzenia postępu rosną monotonicznie — [test]
- [ ] Enter/Spacja na nagłówku grupy zwija i rozwija jej wiersze — [test: model + render]
- [ ] F5 i Shift+R wyzwalają pełny rescan; małe r nie wyzwala — [test]

---

## Phase 3: Panel boczny — leniwe szczegóły i flagi możliwości

**User stories**: 9, 10, 11

### What to build

Zaznaczenie narzędzia wypełnia prawy panel (styl: podgląd diff w Claude): wersja, ścieżka binarki, metoda instalacji, rozmiar na dysku (liczony **leniwie — przy zaznaczeniu**), lokalizacje config/cache/docs. Brak danych = „—", a akcje od nich zależne wygasają. Flagi możliwości (`canUpdate / canRemove / hasCache / canReveal`) sterują aktywnością skrótów u/r/f/c (wizualne wygaszenie). Panel aktualizuje się przy każdej zmianie zaznaczenia strzałkami.

### Assumptions carried in

- Faza 2: pełna lista, scalanie i rescan działają.
- tool-info dociąga dane pojedynczego narzędzia na żądanie (nie w skanie).

### Out of scope for this phase

- Wykonywanie akcji — faza 4 (tu tylko gotowość przez flagi).
- Reveal właściwy — faza 5 (tu powstaje flaga `canReveal`).

### Acceptance criteria

- [ ] tool-info zwraca komplet danych dla fikcyjnego narzędzia (wersja / ścieżka / metoda / rozmiar / config / cache / docs) — [test: fixture drzewa katalogów]
- [ ] Rozmiar **nie** jest liczony podczas skanu — dopiero przy pierwszym zaznaczeniu — [test: asercja braku wywołań podczas skanu]
- [ ] Braki danych → „—" w panelu; flagi odpowiednio false — [test: render]
- [ ] Macierz flag: narzędzie bez znanego menedżera → canUpdate/canRemove false; bez znanego cache → hasCache false; bez wykrytego reveal → canReveal false; skróty wygasają dokładnie wg flag — [test: matryca]
- [ ] ↑↓ aktualizuje panel bez przeładowania listy — [test: ink-testing-library]

---

## Phase 4: Akcje — aktualizacja (u) i usuwanie (r) z obsługą sudo

**User stories**: 12, 13, 16, 17

### What to build

Generowanie i wykonywanie komend per menedżer. **u** = update: `brew upgrade X`, `npm update -g X`, `pip3 install -U X`, `cargo install --force X`, `go install X@latest`, `sudo apt install --only-upgrade X` / `dnf upgrade X` / `pacman -S X` / `zypper update X` / `apk upgrade X` oraz (decyzja /carve) `winget upgrade X` / `choco upgrade X` / `scoop update X`. **r** = remove (analogiczne uninstall/y) — z **dialogiem potwierdzenia** i checkboxem „usuń też config i cache" (ścieżki z tool-info). Porażka uprawnień (sudo): komunikat + **gotowa komenda do skopiowania** + **aktywny przycisk retry**. Po każdej zakończonej akcji wiersz narzędzia odświeża się automatycznie.

### Assumptions carried in

- Faza 3: flagi możliwości i tool-info (ścieżki do czyszczenia) działają.
- Akcje wykonują się tylko przy flagach true (wygaszone skróty nie wykonują nic).

### Out of scope for this phase

- Reveal (f/c) — faza 5.
- Instalowanie narzędzi — zostaje w wizardzie `adm` (v3).

### Acceptance criteria

- [ ] Dry-run generacji update zwraca dokładnie oczekiwane komendy dla wszystkich 13 menedżerów — [test: matryca komend]
- [ ] Dry-run generacji remove analogicznie; checkbox „config+cache" dodaje czyszczenie ścieżek z tool-info — [test]
- [ ] Dialog bez potwierdzenia = zero wykonania akcji — [test]
- [ ] Maszyna stanów sudo: symulowana porażka uprawnień → stan „zablokowane" z komunikatem, komendą do skopiowania i aktywnym retry; retry ponawia tę samą komendę — [test]
- [ ] Po remove wpis znika z listy, po update wiersz pokazuje nowy stan — odświeżenie automatyczne, bez ręcznego rescanu — [test]

---

## Phase 5: Reveal (f/c), minimalny rozmiar, integracja CI

**User stories**: 14, 15, 19, 21

### What to build

**f** = reveal folderu narzędzia, **c** = reveal folderu cache — per system: `open -R <path>` (macOS), `explorer /select,<path>` (Windows), `xdg-open <folder>` (Linux). Brak menedżera plików (headless) → akcja wygaszona (flaga `canReveal` z fazy 3). Terminal mniejszy niż ~80×24 → czytelny ekran „terminal too small" zamiast rozjechanego UI. Integracja CI: fikcyjne narzędzie (skrypt na PATH + wpis w rejestrze + fake cache) przechodzi cały przepływ na ubuntu/macos/windows.

### Assumptions carried in

- Fazy 1–4 kompletne; flaga `canReveal` istnieje od fazy 3.
- Reveal zależy od obecności menedżera plików w systemie.

### Out of scope for this phase

- Podkomendy skryptowe (`adm tools list/update/remove`, `--json`) — przyszłe wydanie (Out of Scope PRD).
- Sterowanie myszą — świadomie odrzucone w PRD.

### Acceptance criteria

- [ ] Generacja reveal zwraca właściwą komendę dla każdej z 3 platform — [test × 3]
- [ ] Brak wykrytego menedżera plików → `canReveal` false, f/c wygaszone — [test]
- [ ] Terminal < 80×24 → ekran minimalnego rozmiaru; zero rozjechanego renderu — [test: render przy wymuszonych małych wymiarach]
- [ ] CI (ubuntu/macos/windows): fikcyjne narzędzie → skan je znajduje, panel się wypełnia, remove je usuwa, wiersz się odświeża — [CI job zielony na 3 OS]
- [ ] `npm test` i pełna macierz CI zielone — [command]

---

## Kryteria „done" całości (z PRD)

- `npm test` zielone; macierz CI zielona (ubuntu/macos/windows).
- 100% poprawności scalania na fixturach (priorytet rejestr > menedżer > katalog).
- Zero aktywnych akcji przy fałszywych flagach możliwości.
- Skan < 5 s na mockach; loader dots_12 cyklicznie; postęp monotoniczny.
