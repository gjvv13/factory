---
id: coverage-in-verify
titel: Coverage laten verzamelen door factory verify
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Coverage laten verzamelen door factory verify

## Samenvatting

`factory verify` gaat altijd testdekking meten, per app een rapport wegschrijven,
en de poort rood maken als de dekking onder een ingestelde ondergrens zakt. Zo
wordt dekking meetbaar én stuurbaar, en kan de beheer-tool het cijfer oppikken
([[test-coverage]]).

## Functionele architectuur

### Gedrag

```
$ pnpm verify
  ==> Unit tests            ✓  (coverage: 87%)
  ==> Contract tests        ✓  (coverage: 100%)
  ==> End-to-end tests      ✓  (coverage: 72%)
  ==> Dekkingsdrempel       ✓  totaal 84% ≥ 80%
  ✓ Alles groen in 12s
```

Onder de drempel:

```
  ==> Dekkingsdrempel       ✗  totaal 71% < 80%
  ✗ Poort faalt: te weinig dekking
```

### Regels en randgevallen

- **Altijd meten.** Coverage draait bij elke volledige `verify`. In `--snel` en
  `--pre-commit` mag het overgeslagen worden om lokaal snel te blijven.
- **Drempel per app** in `factory.json` (bijv. `"dekkingsMinimum": 80`). Ontbreekt
  hij, dan wel meten en tonen, maar niet falen — zodat bestaande apps niet meteen
  rood staan.
- **Rapport op een vaste plek** (`coverage/coverage-summary.json`, al gitignored)
  zodat [[test-coverage]] het per app kan vinden.
- Een testsoort die de app niet heeft, telt niet mee (net als in de poort zelf).

### Wat het expliciet níet doet

- Geen per-bestand-oordeel in de poort; alleen totaal (en per testsoort tonen).
- Start geen coverage-run vanuit de beheer-tool; die leest alleen het rapport.

## Technische architectuur

### Onderdelen

| Laag       | Bestand                       | Wat er verandert                                                                     |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| configs    | `configs/vitest-unit.js` e.a. | coverage-provider aanzetten, rapport wegschrijven                                    |
| commands   | `src/commands/verify.ts`      | coverage-vlag doorgeven, drempelstap toevoegen, in `--snel`/`--pre-commit` overslaan |
| app-config | `src/app-config.ts`           | `dekkingsMinimum` inlezen/valideren (Zod)                                            |
| skeleton   | `skeleton/…`                  | drempel als voorbeeld in `factory.json`                                              |

### Datamodel

Geen (rapport is een bestand, geen database).

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — Coverage meten en rapporteren

- **Doel:** `verify` meet dekking per testsoort en schrijft een rapport weg; nog
  geen oordeel.
- **Acceptatiecriteria:**
  - [ ] De vitest-presets produceren coverage.
  - [ ] `verify` toont per testsoort een percentage.
  - [ ] Een rapport staat op de vaste plek voor [[test-coverage]].
  - [ ] `--snel` en `--pre-commit` slaan coverage over.
- **Tests:** unit: `verify` slaat coverage over in snel/pre-commit (gemockte
  scripts) · e2e: n.v.t.
- **Flag:** geen

### Slice 2 — Ondergrens die de poort rood maakt

- **Doel:** een drempel per app laat de poort falen onder de grens.
- **Acceptatiecriteria:**
  - [ ] `dekkingsMinimum` uit `factory.json` wordt gevalideerd ingelezen.
  - [ ] Totaal onder de drempel → `verify` faalt met een heldere melding.
  - [ ] Geen drempel ingesteld → meten en tonen, niet falen.
- **Tests:** unit: drempelstap met een rapport boven/onder de grens · e2e: n.v.t.
- **Flag:** geen

## Risico's

- **Coverage vertraagt verify.** Vandaar overslaan in `--snel`/`--pre-commit`; de
  volledige poort (lokaal bewust, in CI) meet wel.
- **Een te hoge drempel blokkeert werk.** Daarom opt-in per app en pas invoeren
  nadat de dekking bekend is (slice 1 vóór slice 2).
- **Coverage-cijfers verschillen per testsoort en optellen is subtiel.** We tonen
  per soort en nemen een totaal; de precieze aggregatie is een detail in slice 1.

## Besluiten

- **Altijd meten + ondergrens**, conform de keuze in refinement. Meten zonder
  oordeel is het startpunt (slice 1); de drempel (slice 2) is opt-in per app zodat
  bestaande code niet meteen rood wordt.
- **Drempel in `factory.json`, niet in de factory-code.** Elke app bepaalt zijn
  eigen lat; de factory levert alleen de machinerie.
- **Dit is de factory-kant van [[test-coverage]]:** dit item levert het rapport,
  dat item toont het in de beheer-tool.
