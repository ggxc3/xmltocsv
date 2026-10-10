# XML → CSV

Desktopová aplikácia (Tauri), ktorá prevádza XML merania z **PROMAX RANGER Neo** (režim FM, `COVERAGE`) do CSV formátu `MeranieMPX_<názov>.csv`.

## Používanie

1. Pretiahni XML súbor(y) do okna, alebo klikni a vyber.
2. Zvoľ, kam uložiť CSV (pri viacerých súboroch sa vyberá priečinok; ak tam už CSV existujú, aplikácia sa spýta, či ich prepísať).

Predvolený profil **MPX** nič nastavovať nepotrebuje.

### Profily

Ikonou ⚙ sa otvorí editor profilu. Profil určuje:

- koľko prvých meracích bodov preskočiť (MPX: 10),
- názov výstupného súboru (`{nazov}` = názov XML súboru),
- zoznam stĺpcov: zdroj (dátum, čas, pevná hodnota alebo veličina z XML), názov, jednotka, prevod `hodnota × násobok + posun` a či sa stĺpec zapíše trojmo ako `(Min)`, `(Average)`, `(Max)`.

Vstavaný profil sa nedá prepísať, úpravy sa uložia ako nový profil. Profily sa dajú exportovať/importovať ako `.json`, takže zákazníkovi stačí poslať súbor profilu.

Keď XML obsahuje veličinu, ktorú profil nezapisuje, aplikácia na to upozorní a ponúkne ju pridať.

### Vstavaný profil MPX

Definícia je v [`src-tauri/profiles/mpx.json`](src-tauri/profiles/mpx.json).

| CSV stĺpec | Zdroj v XML | Prevod |
|---|---|---|
| Time Stamp / TimeStamp | `CPOINT@date` / `CPOINT@time` | `2026-04-22` → `22.04.2026` |
| Level | `LEVEL` (dBµV) | −107 → dBm |
| MPX Power | `MODULATIONPOWER` (dBr) | — |
| Deviation MPX | `MPXFREQUENCYDEVIATION` (kHz) | ×1000 → Hz |
| AM Depth | `AMDEPTH` (%) | — |
| Peak Deviation, RF Offset, Deviation M/Pilot/S/RDS/DARC/SCA | — | `0.0` |
| GPS Longitude/Latitude/Altitude/HDOP | — | `INV` |

Čísla sa zapisujú rovnako ako v pôvodnom programe (formát Python `repr`, napr. `-32.099999999999994`). Test `reproduces_original_program_output` overuje, že výstup je bajt po bajte zhodný s pôvodným CSV.

## Vývoj

Potrebné: Node.js 22+, Rust (`rustup`).

```sh
npm install
npm run tauri dev      # spustenie aplikácie
cd src-tauri && cargo test   # testy (vyžadujú `npm run build` kvôli dist/)
```

## Release

GitHub → **Actions → Release (semver) → Run workflow**:

- `bump`: `patch` / `minor` / `major`, alebo
- `version_override`: presná verzia `X.Y.Z`.

Workflow na Windows otestuje a zostaví aplikáciu, commitne novú verziu (`package.json`, `Cargo.toml`, `Cargo.lock`) do `main`, vytvorí tag `vX.Y.Z` a GitHub Release so súborom `XmlToCsv_X.Y.Z.exe` (prenosný, bez inštalácie; potrebuje WebView2, ktorý je súčasťou Windows 10/11).
