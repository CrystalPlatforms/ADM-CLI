# PRD: ADM v0.4.0 — `adm tools`, pełnoekranowe TUI zarządzania narzędziami

> Powstało w sesji /ask (2026-11-07). Kontynuacja linii produktu z PRD v0.3.0 (`plans/PRD-v0.3.md`, issue #25). **Uwaga:** w PRD v0.3.0 zapisano, że `adm doctor` trafi do v0.4.0 — ta decyzja zmieniła się w trakcie tej sesji: v0.4.0 dostaje `adm tools`, a `adm doctor` wraca później jako osobna funkcja diagnostyczna.

## Problem Statement

Po v0.3.0 użytkownik potrafi zainstalować narzędzia przez `adm`, ale nie ma jak nimi zarządzać:

- nie widzi **jednej listy** tego, co ma w systemie (narzędzia rozproszone między brew, npm -g, pip, cargo, go, apt/dnf/pacman/zypper/apk, ręczne instalacje),
- nie sprawdzi szybko wersji, skąd pochodzi narzędzie ani ile zajmuje,
- aktualizacja/usunięcie wymaga pamiętania komend każdego menedżera z osobna,
- nie wiadomo, gdzie narzędzie trzyma config/cache.

Dziś trzeba to robić ręcznie, w 6–8 różnych komendach menedżerów.

## Solution

`adm tools` = **pełnoekranowa aplikacja TUI** (jedyna w paczce ADM): równoległy skan komputera z animowanym loaderem, potem lista wszystkich zainstalowanych narzędzi **pogrupowana wg źródła** (ADM / npm / brew / pip / cargo / go / system / poza menedżerem), grupy zwijane klawiaturą. Zaznaczenie narzędzia pokazuje **panel boczny** (styl: podgląd diff w Claude) ze wszystkimi danymi wyciągniętymi z komputera. Akcje pod klawiszami: **u** aktualizuj, **r** usuń (dialog + opcjonalne czyszczenie config/cache), **f** pokaż folder w menedżerze plików, **c** pokaż cache. Sterowanie **wyłącznie klawiaturą** — maksymalna kompatybilność (SSH, każdy terminal). Przyciski, których nie da się wykonać, wygasają; przy braku uprawnień (sudo) przycisk zostaje aktywny z podpowiedzią, komendą do skopiowania i możliwością ponownej próby.

## User Stories

**Skan i lista**
1. Jako użytkownik, chcę żeby `adm tools` otworzyło pełnoekranowe TUI z ekranem skanowania (loader dots_12 + "scanning 45/280…"), żeby widzieć, że coś się dzieje.
2. Jako użytkownik, chcę jedną listą zobaczyć **wszystkie zainstalowane narzędzia** z katalogu ADM, list menedżerów i rejestru ADM, żeby niczego nie przeoczyć.
3. Jako użytkownik, chcę narzędzia **pogrupowane wg źródła** (ADM / npm global / brew / pip / cargo / go / system / poza menedżerem), żeby rozumieć skąd każde pochodzi.
4. Jako użytkownik, chcę **zwijać i rozwijać grupy** (Enter/Spacja na nagłówku grupy), żeby listy setek pozycji były czytelne.
5. Jako użytkownik, chcę żeby duplikaty (to samo narzędzie w katalogu i u menedżera) były **scalane w jedną pozycję**, żeby lista nie kłamała.
6. Jako użytkownik, chcę narzędzia zainstalowane przez ADM w osobnej grupie **ADM**, żeby wiedzieć, za które odpowiada rejestr.
7. Jako użytkownik bez brew (albo innego menedżera), chcę żeby brakujący menedżer dawał **pustą grupę, a nie błąd**, żeby TUI zawsze wstało.
8. Jako użytkownik, chcę **F5/r** = pełny ręczny rescan, żeby odświeżyć listę po ręcznych zmianach w terminalu.

**Panel informacji (prawa strona)**
9. Jako użytkownik, chcę po zaznaczeniu narzędzia widzieć w panelu: **wersję, ścieżkę binarki, metodę instalacji, rozmiar na dysku, lokalizacje config/cache/dokumentacji**, żeby mieć pełny obraz.
10. Jako użytkownik, chcę żeby brakujące dane pokazywały "—", a akcje od nich zależne **wygasały**, żeby interfejs nigdy nie kłamał.
11. Jako użytkownik, chcę żeby panel aktualizował się przy zmianie zaznaczenia strzałkami, żeby przeglądanie było płynne.

**Akcje**
12. Jako użytkownik, chcę **u** = aktualizacja narzędzia przez jego menedżera (`brew upgrade`, `npm update -g`, `pip3 install -U`…), żeby nie pamiętać komend.
13. Jako użytkownik, chcę **r** = usunięcie z **oknem potwierdzenia** i opcjonalnym checkboxem "usuń też config i cache", żeby decydować o głębokości czyszczenia.
14. Jako użytkownik, chcę **f** = otwarcie folderu narzędzia w **menedżerze plików systemowym** (reveal), żeby zobaczyć pliki na własne oczy.
15. Jako użytkownik, chcę **c** = otwarcie **folderu cache** narzędzia (reveal), żeby móc go ręcznie wyczyścić.
16. Jako użytkownik, przy akcji wymagającej uprawnień (sudo) chcę: komunikat, **gotową komendę do skopiowania** i **aktywny przycisk ponownej próby**, żeby blokada nigdy nie była ślepa.
17. Jako użytkownik, chcę żeby po każdej zakończonej akcji **wiersz narzędzia odświeżył się automatycznie**, żeby widzieć realny stan.

**Sterowanie i odporność**
18. Jako użytkownik przez SSH / w dowolnym terminalu, chcę pełną obsługę **tylko klawiaturą** (↑↓, Enter/Spacja, u/r/f/c, F5/r, q), żeby `adm tools` działało wszędzie.
19. Jako użytkownik z małym oknem terminala, chcę czytelny komunikat z **minimalnym rozmiarem** zamiast rozjechanego UI.
20. Jako użytkownik, chcę napisy interfejsu **po angielsku**, żeby spójnie z resztą ADM.
21. Jako użytkownik na Windows/macOS/Linux, chcę żeby reveal (f/c) używał właściwego dla systemu menedżera plików, żeby akcja działała natywnie.

## Implementation Decisions

**Składniki (rozbudowa modułów z v0.3.0 + nowe):**
1. **platform + pkg (rozbudowana strona odczytu)** — każdy menedżer umie wypisać swoje pakiety: brew (`brew list --json`), npm (`npm ls -g --json`), pip (`pip3 list --format=json`), cargo (`cargo install --list`), go (skan `~/go/bin`), systemowe zapytania (dpkg/rpm/pacman/zypper/apk). Parser wersjonowany per menedżer.
2. **inventory** (nowy, głęboki) — scala 3 źródła: wykrycie katalogu (v3), listy menedżerów, rejestr ADM. Skan **równoległy** ze zdarzeniami postępu. Atrybucja źródła: rejestr ADM > lista menedżera > katalog; duplikaty scalone. Brak menedżera = pusta grupa.
3. **tool-info** (głęboki) — dla zaznaczonego narzędzia: wersja, ścieżki, metoda, rozmiar (liczony leniwie — nie podczas skanu), config/cache/docs + **flagi możliwości** (canUpdate / canRemove / hasCache / canReveal), które sterują wygaszaniem przycisków.
4. **tool-actions** (głęboki) — generowanie i wykonanie komend akcji per menedżer; obsługa porażki sudo: podpowiedź + komenda do skopiowania + retry; reveal per system (`open -R` / `explorer /select` / `xdg-open`).
5. **tools-tui** (ekran ink — jedyny import inka w paczce) — ekran skanu (klatki dots_12 z `loader.txt`, licencja MIT, atrybucja cli-spinners/cli-loaders w kodzie), lista grup z zwijaniem, panel boczny, dialog potwierdzenia z checkboxem, komunikat minimalnego rozmiaru (~80×24). Skróty: ↑↓ nawigacja, Enter/Spacja zwijanie grupy, u/r/f/c akcje, F5/r rescan, q wyjście.
6. **adm-registry** (mały) — `~/.adm/installed.json` {id, name, method, installedAt}: pisany przez instalator v0.3.0 przy każdej instalacji, czytany przez inventory.

**Granice:** TUI (5) jest wyłącznie "skórką" — `inventory`/`tool-info`/`tool-actions` są neutralne terminalowo i testowalne bez interakcji. Rozmiar na dysku i głębokie info = leniwie przy zaznaczeniu, nie w skanie startowym.

**Zależności:** ink wraca do package.json (używany wyłącznie przez `adm tools`); reszta paczki bez zmian z v0.3.0.

**Wersjonowanie:** v0.4.0. Kolejność wdrożenia: **najpierw v0.3.0**, potem v0.4.0 (potrzebuje platform/pkg i rejestru z v3).

## Assumptions

- **Formaty wyjść menedżerów bywają zmienne** między wersjami (npm/pip/brew JSON) — parsery wersjonowane, porażka parsowania = pusta grupa + wiersz ostrzeżenia, nigdy crash.
- **ink działa pod prywatnym Node** w paczce przenośnej (to samo założenie co inquirer w v3).
- Terminal **≥ ~80×24** wystarcza; mniejszy → komunikat, nie próba rysowania.
- Sterowanie **tylko klawiatura jest akceptowalne** dla wszystkich użytkowników (decyzja właściciela — mysz odrzucona dla maksymalnej kompatybilności).
- Rozmiar katalogów bywa duży — liczenie **leniwie przy zaznaczeniu**; skan startowy tego nie robi.
- Klatki loadera dots_12 (MIT) mogą być osadzone w kodzie z atrybucją.
- Rejestr `installed.json` jest wiarygodny (pisany automatycznie przez v3); ręczne kasowanie pliku degraduje tylko grupę ADM.
- Reveal zależy od obecności menedżera plików w systemie (na headless serverach akcja się wygasza).

## Tradeoffs Considered

- **Obsługa myszy (hover/klik)** — odrzucone decyzją właściciela: maksymalna kompatybilność (terminals/SSH bez myszy); zwijanie grup przejęła klawiatura.
- **blessed / własny TUI na ANSI** — odrzucone: ink jest utrzymywany, komponenty Reactowe szybsze w budowie; paczka rośnie o kilka MB tylko dla tego ekranu.
- **`adm tools list/update <nazwa>` (podkomendy skryptowe)** — odrzucone w tym wydaniu decyzją właściciela: v4 = wyłącznie TUI.
- **`adm doctor` jako funkcja v4** — odrzucone decyzją właściciela: doctor wróci później jako osobna funkcja diagnostyczna; v4 = `adm tools`.
- **Głęboki skan wszystkiego na starcie (wersje + rozmiary)** — odrzucone: za wolne; lekki skan równoległy + leniwe dociąganie szczegółów.
- **Kosz zamiast trwałego usunięcia** — odrzucone: dialog potwierdzenia + trwałe usunięcie (decyzja właściciela).
- **Jedna płaska lista alfabetyczna** — odrzucona: grupy wg źródła czytelniejsze i od razu mówią, czym usunąć narzędzie.
- **Parsowanie na siłę wszystkich formatów** — odrzucone: porażka parsera degraduje grupę do pustej + ostrzeżenie, zamiast ryzykować crash.

## Validation Strategy

**Nacisk: inventory (skan listy) + akcje narzędzi (decyzja właściciela).**

**Inventory — testy jednostkowe na fixturach wyjść menedżerów:**
- brew `list --json` (realny fragment JSON v2), npm `ls -g --json`, pip `list --format=json`, `cargo install --list`, `dpkg-query`/`rpm`/`pacman -Q` → poprawne sparsowane wpisy (nazwa, wersja, ścieżka).
- **Scalanie i atrybucja:** to samo narzędzie w katalogu + menedżerze + rejestrze → **jedna** pozycja; priorytet źródła: rejestr ADM > menedżer > katalog (test na ≥5 kolizjach).
- **Odporność:** zepsuty JSON / brak menedżera / brak `installed.json` → pusta grupa + ostrzeżenie, TUI wstaje (test na każdej z 8 grup).
- **Wydajność:** 280 pozycji katalogu + fixtury menedżerów, mockowany exec → pełny skan < 5 s; zdarzenia postępu rosną monotonicznie do 280/280.
- **Loader:** klatki dots_12 cyklicznie; po zakończeniu skanu ekran listy zastępuje skan.

**Akcje — testy generowania komend (dry-run) per menedżer:**
- update: `brew upgrade X`, `npm update -g X`, `pip3 install -U X`, `cargo install --force X`, `go install X@latest`, `sudo apt install --only-upgrade X` / `dnf upgrade X` / `pacman -S X` / `zypper update X` / `apk upgrade X`.
- remove: analogicznie (`brew uninstall X`, `npm uninstall -g X`, `pip3 uninstall -y X`, `apt remove X`…); checkbox "config+cache" dodaje ścieżki czyszczenia z tool-info.
- **Ścieżka sudo:** symulowana porażka uprawnień → komunikat + komenda do skopiowania + przycisk retry aktywny (test maszyny stanów).
- **Reveal:** per OS generuje `open -R <path>` (macOS), `explorer /select,<path>` (Windows), `xdg-open <folder>` (Linux); brak menedżera plików → akcja wygaszona.
- **Flagi możliwości:** narzędzie bez znanego menedżera → u/r wygaszone; bez znanego cache → c wygaszone (test matrycy flag).

**Integracja CI:** fikcyjne narzędzie (skrypt na PATH + wpis w rejestrze + fake cache) → skan je znajduje, panel się wypełnia, remove go usuwa, wiersz się odświeża; uruchamiane na ubuntu/macos/windows.

**HITL (po implementacji):** `adm tools` → przegląd grup → zwijanie → panel → u na 1 narzędziu → r z checkboxem → f/c reveal → F5 → q; powtórka przez SSH.

**Kryteria "done":** `npm test` zielone; macierz CI zielona; 100% poprawności scalania na fixturach; zero aktywnych akcji przy fałszywych flagach możliwości; skan < 5 s na mockach.

## Out of Scope

- **`adm doctor`** — wraca później jako **osobna** funkcja diagnostyczna (raport systemu/PATH/uprawnień); nie jest częścią v4.
- **Podkomendy skryptowe** (`adm tools list/update/remove <nazwa>`, `--json`) — przyszłe wydanie.
- **Sterowanie myszą** — świadomie odrzucone.
- **Instalowanie narzędzi** — to zostaje w wizardzie `adm` (v3); `adm tools` tylko zarządza.
- **Aktualizacja samego ADM** — `adm upgrade` z v3.
- Motywy/zaawansowane konfiguracje wyglądu TUI.

## Further Notes

- Wdrożenie **po v0.3.0** (potrzebuje jego modułów i rejestru instalacji).
- `loader.txt` leży w katalogu głównym repo — przy implementacji klatki trafią do kodu z atrybucją, plik zostanie usunięty.
- **Rozbieżność do rozstrzygnięcia przez właściciela:** issue #25 (PRD v0.3.0) nadaje przypisuje doctora do v4 — właściciel wybrał opcję "tylko plik", więc issue **nie zostało** zaktualizowane; przy /carve jednej z wersji warto to sprostować w komentarzu.
- Pełne decyzje sesji /ask v4: tabela w transkrypcie rozmowy (grupy, akcje, loader, sterowanie).
