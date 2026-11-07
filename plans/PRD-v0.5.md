# PRD: ADM v0.5.0 — `adm doctor`, diagnostyka instalacji i środowiska (read-only)

> Powstało w sesji /ask (2026-11-07). Trzecia część linii produktu: v0.3.0 (przebudowa, issue #25) → v0.4.0 (`adm tools`, plans/PRD-v0.4.md) → **v0.5.0 (ten dokument)**. Mała aktualizacja.

## Problem Statement

Gdy coś w ADM lub w środowisku zaczyna działać dziwnie (komenda "znikła", ADM nie wstaje po upgrade, PATH ma dziwności), użytkownik nie ma żadnego narzędzia, które wskaże przyczynę. Zgłoszenie problemu sprowadza się do zgadywania — a większość typowych usterek (resztki po starych wersjach, uszkodzony config, rozjazdy rejestru, zdublowane wpisy PATH, zniknięty menedżer) da się wykryć automatycznie prostym skanem.

## Solution

`adm doctor` = **read-only skan zdrowia**: instalacji ADM (paczka, config, rejestr, resztki) i środowiska narzędzi (PATH, shadowing, rozjazdy, sieć, dysk). Raport w terminalu z sekcjami i kolorami ✓/⚠/✗; przy każdym problemie **gotowa komenda do skopiowania**. Zakres do wyboru flagami (`--install`, `--env`). Opcja `--json` dla skryptów/CI. Kody wyjścia 0/1/2. Ostatni wynik zapisywany w `~/.adm/doctor-last.json` — gotowy materiał do wklejenia przy zgłaszaniu problemów. Żadnych automatycznych napraw, żadnego auto-uruchamiania.

## User Stories

**Uruchamianie i zakres**
1. Jako użytkownik, chcę `adm doctor` uruchamiający pełny skan i pokazujący raport w sekcjach z kolorem ✓/⚠/✗, żeby jednym spojrzeniem znać stan.
2. Jako użytkownik, chcę `adm doctor --install` = tylko zdrowie instalacji ADM (paczka, config, rejestr, resztki, prywatny Node), żeby sprawdzić sam produkt.
3. Jako użytkownik, chcę `adm doctor --env` = tylko środowisko (PATH, shadowing, rozjazdy, sieć, dysk/cache), żeby diagnozować otoczenie narzędzi.
4. Jako użytkownik, chcę żeby `adm` (menu) startował **bez** żadnego automatycznego doctora, żeby nic nie spowalniało startu.

**Testy — instalacja (scope: install)**
5. Jako użytkownik, chcę sprawdzenie **kompletności paczki** (launcher + app + prywatny Node obecne, wersje zgodne), żeby wiedzieć czy instalacja nie jest uszkodzona.
6. Jako użytkownik, chcę wykrywanie **resztek po starych wersjach** (`tokens.enc`, `ai-knowledge.json`, katalogi tmp/backup po upgrade), żeby wiedzieć co można posprzątać.
7. Jako użytkownik, chcę walidację **config.json** (poprawny JSON, znane pola) i **installed.json** (wpisy → istniejące binarki), żeby uszkodzone dane nie zaskoczyły później.
8. Jako użytkownik, chcę sprawdzenie **prywatnego Node** (uruchamialny, oczekiwana wersja, brak "przecieku" do systemowego PATH), żeby runtime paczki był zdrowy.

**Testy — środowisko (scope: env)**
9. Jako użytkownik, chcę audyt **PATH**: duplikaty, katalogi które nie istnieją, zdublowane wpisy adm w wielu plikach rc, żeby wiedzieć co posprzątać.
10. Jako użytkownik, chcę wykrywanie **shadowingu** (ta sama komenda w kilku miejscach PATH — np. dwa node'y) z pokazaniem, która wygrywa, żeby rozumieć dziwne zachowania.
11. Jako użytkownik, chcę wykrywanie **rozjazdów rejestru**: wpis mówi "brew", a brew nie istnieje; albo binarka narzędzia zniknęła z dysku, żeby wiedzieć które pozycje są martwe.
12. Jako użytkownik, chcę test **osiągalności GitHub Releases** (z krótkim timeoutem), żeby wiedzieć czy `adm upgrade` zadziała.
13. Jako użytkownik, chcę podgląd **miejsca na dysku i rozmiarów cache'ów** (npm/pip/cargo), żeby kontrolować zajętość.

**Wyjście**
14. Jako użytkownik, chcę przy **każdym problemie gotową komendę do skopiowania**, żeby naprawa była jednym wklejeniem (naprawiam sam — doctor nie zmienia plików).
15. Jako użytkownik, chcę `adm doctor --json`, żeby maszynowalny wynik używać w skryptach/CI.
16. Jako użytkownik, chcę **kody wyjścia 0/1/2** (OK / ostrzeżenia / błędy), żeby doctor używalny był w automatyzacji.
17. Jako użytkownik zgłaszający problem, chcę wynik zapisany w **`~/.adm/doctor-last.json`**, żeby móc go wkleić do zgłoszenia zamiast opisywać z pamięci.
18. Jako użytkownik, chcę podsumowanie na końcu raportu (ile ✓/⚠/✗, czas skanu), żeby szybko ocenić stan całości.

## Implementation Decisions

**Składniki:**
1. **checks** (głęboki moduł) — rejestr niezależnych funkcji-sprawdzeń; każda: `{ id, scope: install|env, run(ctx) → findings[] }`, finding: `{ severity: ok|warn|error, message, fixCommand? }`. 9 testów z PRD = 9 funkcji; nowy test = nowa funkcja w rejestrze (runner i raport bez zmian).
2. **doctor-runner** — wybór zakresu (pełny / `--install` / `--env`), sekwencyjne uruchomienie sprawdzeń z wyjątkiem testu sieciowego (timeout ≤ 3 s), agregacja do obiektu raportu (metadane: wersja ADM, system, czas skanu).
3. **doctor-report** — dwa adaptery tego samego raportu: renderer terminalowy (sekcje, ✓/⚠/✗, podsumowanie, komendy do skopiowania w blokach kodu) i serializer `--json`; zawsze zapis `~/.adm/doctor-last.json`.
4. **exit-codes** — mapowanie: brak ⚠/✗ → 0; są ⚠ → 1; są ✗ → 2.

**Klasyfikacja ważności (stała, nie podlega interpretacji przy implementacji):**
- **error (✗)**: paczka niekompletna / niezgodne wersje; config.json niepoprawny JSON; wpis rejestru wskazuje na nieistniejącą binarkę; prywatny Node nieuruchamialny lub w złej wersji.
- **warn (⚠)**: resztki po starych wersjach; duplikaty/martwe katalogi na PATH; zdublowane wpisy adm w rc; shadowing komend; menedżer z rejestru nieobecny; GitHub Releases nieosiągalny; mało miejsca na dysku; duże cache; prywatny Node "cieknący" do systemowego PATH.
- **ok (✓)**: wszystko poza powyższym.

**Granice:** sprawdzenia są **read-only** (jedyne zapisy: `doctor-last.json`); korzystają z modułów v3 (platform, rejestr, układ paczki) — na instalacjach starszych niż v3 testy zależne od tych artefaktów zwracają "nie dotyczy" (linia informacyjna), nie błąd.

**Wersjonowanie:** v0.5.0; wdrożenie **po v0.3.0 i v0.4.0** (potrzebuje ich układu paczki i rejestru).

## Assumptions

- Doctor nie może wykrywać bugów w kodzie ADM — zakres to **integralność instalacji + środowisko** (decyzja właściciela, Q1:2).
- Brak internetu = ostrzeżenie (⚠), nie błąd — doctor ma działać offline.
- Shadowing i duplikaty PATH bywają nieszkodliwe → zawsze ⚠, nigdy ✗.
- `doctor-last.json` zawiera lokalne ścieżki — plik zostaje na maszynie użytkownika; udostępnia go tylko dobrowolnie.
- Progi "mało miejsca" (np. < 2 GB) i "duży cache" (np. > 5 GB łącznie) są stałe w kodzie — bez konfiguracji w tym wydaniu.
- Uruchomienie na instalacji sprzed v3 (brak układu paczki/rejestru) → linie "nie dotyczy", exit 0 dla tych pozycji.

## Tradeoffs Considered

- **Raport jako TUI (jak adm tools)** — odrzucone: "mała aktualizacja"; zwykły raport terminalowy jest szybszy w budowie i czytelny w logach.
- **Auto-naprawy (`--fix`, pytania y/N)** — odrzucone w tym wydaniu decyzją właściciela: doctor read-only; naprawa = skopiowanie komendy.
- **Auto-uruchamianie po `adm upgrade` / przy starcie** — odrzucone decyzją właściciela: tylko na żądanie (Q5:1).
- **Zawsze exit 0** — odrzucone: kody 0/1/2 są warunkiem użycia doctora w CI/skryptach (Q6:1).
- **Poszukiwanie bugów w kodzie ADM przez doctora** — odrzucone: niewykonalne na maszynie użytkownika; to rola testów/CI w development.
- **`--report` generujący sformatowany tekst do issue** — odrzucone w tym wydaniu: wystarczy `doctor-last.json` (Q7:2); format do issue można dodać później.
- **Testy równoległe** — odrzucone: sprawdzenia są szybkie i tanie; jedynie sieciowy ma timeout, równoległość nie daje tu realnego zysku.

## Validation Strategy

**Testy jednostkowe checków (fixture Drzewa ~/.adm i PATH, mock-fs / mock exec):**
- Kompletność paczki: fixture kompletna → ✓; brak launchera / runtime w złej wersji → ✗ z fixCommand ("adm upgrade" / reinstall hint).
- Resztki: obecność `tokens.enc`, `ai-knowledge.json`, katalogu backup → ⚠ + fixCommand usunięcia; czysta fixture → ✓.
- config/installed: poprawne → ✓; zepsuty JSON → ✗; wpis → brakująca binarka → ✗; wpis → nieobecny menedżer → ⚠.
- PATH: fixture z duplikatem, martwym katalogiem i podwójnym wpisem adm w dwóch rc → trzy osobne ⚠; czysty → ✓.
- Shadowing: sceneria z dwoma "node" na PATH → ⚠ z listą ścieżek i zwycięzcą.
- Sieć: mock fetch — odpowiedź 200 → ✓; timeout → ⚠ (nie ✗); offline → ⚠.
- Dysk/cache: mock statfs → progi działają (poniżej progu ⚠, powyżej ✓).
- Prywatny Node: mock exec — działa+właściwa wersja → ✓; crash → ✗; obecny w systemowym PATH → ⚠.

**Runner i wyjścia:**
- Zakresy: `--install` uruchamia wyłącznie checki install (i odw.); pełny skan = install + env.
- `--json`: stabilny schemat (id, severity, message, fixCommand, metadane) — test kontraktowy.
- Exit codes: raport bez ⚠/✗ → 0; z ⚠ → 1; z ✗ → 2 (test na 3 fixture).
- `doctor-last.json` zapisany po każdym uruchomieniu z identyczną treścią jak `--json`.
- Read-only: po uruchomieniu na fixture drzewo ~/.adm **bez zmian** poza `doctor-last.json` (test integralności).
- Wydajność: pełny skan (mock sieć 200 ms) < 5 s.

**HITL (po implementacji):** `adm doctor` → pełny raport; `--install` i `--env` osobno; `--json | jq`; skopiowanie jednej fixCommand i wykonanie jej; sprawdzenie `doctor-last.json`; kody wyjścia przez `echo $?` (zdrowy i zepsuty fixture).

**Kryteria "done":** wszystkie 9 testów zaimplementowane jako funkcje w rejestrze; pełne pokrycie fixtur powyżej; `npm test` i CI zielone; raport read-only potwierdzony testem integralności.

## Out of Scope

- **Auto-naprawy** (`--fix`, interaktywne naprawy) — przyszłe wydanie, jeśli właściciel zdecyduje.
- **TUI** dla doctora.
- **Auto-uruchamianie** (po upgrade / przy starcie).
- **Wykrywanie bugów w kodzie ADM** — rola testów/CI.
- **--report do issue** — wystarczy doctor-last.json (można dodać później).
- Telemetria — nie istnieje i nie powstanie.

## Further Notes

- Kolejność wdrożenia: **v0.3.0 → v0.4.0 → v0.5.0**; ten PRD korzysta z układu paczki przenośnej i rejestru instalacji z v3 oraz nazewnictwa z v4.
- Rozbieżność z issue #25 (doctor przypisany tam do v4) dotyczy teraz dwóch wersji — przy /carve v3 warto sprostować komentarzem (właściciel dotąd wybierał "tylko plik" dla v4/v5, więc issue pozostaje niezmienione).
- Skład componentów zatwierdzony przez właściciela (checks / doctor-runner / doctor-report / exit-codes).
