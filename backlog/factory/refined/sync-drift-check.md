---
id: sync-drift-check
titel: sync --check die drift tussen factory en apps signaleert
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# sync --check die drift tussen factory en apps signaleert

## Samenvatting

`factory sync` krijgt een `--check`-modus die niets schrijft, verschillen toont
tussen de factory en de app (inclusief bestanden die in de app zijn
achtergebleven), en met een niet-nul exit eindigt bij divergentie. Zo kan CI
falen als een app uit de pas loopt met de factory.

## Functionele architectuur

### Gedrag

```
$ factory sync --check
  ==> Controleren of app gelijk is aan de factory
  ✓ .github/workflows/ci.yml
  ✗ .claude/commands/idee.md wijkt af
  ✗ .claude/commands/oud-commando.md staat in de app maar niet in de factory
  ✗ 2 verschil(len) — draai `factory sync` om gelijk te trekken
  (exit 1)
```

Zonder `--check` blijft het huidige gedrag: kopiëren en melden.

### Regels en randgevallen

- **Verwijderingen detecteren:** een bestand dat wél in de app-map staat maar niet
  (meer) in de factory, is drift en telt mee.
- **Alles gelijk:** `✓ alles gelijk`, exit 0.
- **Negeerlijst:** bewuste afwijkingen per app worden niet als drift gemeld (zie
  Besluiten).
- **Buiten een app-map:** faalt met de bestaande melding.

### Wat het expliciet níet doet

- Geen automatische fix in check-modus (dat is juist gewoon `sync`).
- Geen drie-weg-merge; het is factory → app, éénrichting. Check meldt alleen.

## Technische architectuur

### Onderdelen

| Laag      | Bestand                | Wat er verandert                                                           |
| --------- | ---------------------- | -------------------------------------------------------------------------- |
| commands  | `src/commands/sync.ts` | `--check`-tak; `syncNaarApp` splitsen in "bepaal verschillen" en "pas toe" |
| cli       | `src/cli.ts`           | vlag `--check` doorgeven                                                   |
| workflows | `workflows/ci.yml`     | optionele stap `factory sync --check`                                      |
| test      | `test/sync.test.ts`    | zie [[cli-commando-tests]]                                                 |

### Datamodel

Geen.

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — sync --check met exit-code

- **Doel:** `--check` toont verschillen (inclusief achtergebleven bestanden) en
  eindigt non-zero bij drift, zonder te schrijven.
- **Acceptatiecriteria:**
  - [ ] `syncNaarApp` is gesplitst: verschillen bepalen zonder bijwerken.
  - [ ] `--check` schrijft niets en toont per bestand gelijk/afwijkend/overbodig.
  - [ ] Exit 0 bij gelijk, exit 1 bij verschil.
  - [ ] Negeerlijst wordt gerespecteerd.
- **Tests:** unit: check tegen een temp-app met een afwijkend en een overbodig
  bestand · e2e: n.v.t.
- **Flag:** geen

### Slice 2 — In CI opnemen

- **Doel:** een PR faalt als de app afwijkt van de factory.
- **Acceptatiecriteria:**
  - [ ] `factory sync --check` draait in `workflows/ci.yml`.
  - [ ] Bestaande apps zijn gelijkgetrokken zodat CI groen start.
- **Tests:** n.v.t. (CI-config); handmatig verifiëren op één app.
- **Flag:** geen

## Risico's

- **Vals-positieven bij bewuste afwijkingen** maken de check irritant en dan zet
  iemand hem uit. De negeerlijst moet dat opvangen; klein beginnen.
- **CI die faalt op drift kan een release blokkeren** op een moment dat je dat
  niet wilt. Daarom is slice 2 apart: eerst de check zelf, dan pas in CI.

## Besluiten

- **Scope = de vier gesyncte soorten** (slash commands, skills, git hook,
  CI-workflow). Gedeelde config uit `node_modules` valt hier buiten; die wordt via
  de pakketversie beheerd, niet via `sync`.
- **Negeerlijst per app in `factory.json`** (bijv. `"syncNegeer": [...]`), zodat
  een bewuste afwijking naast de app-config staat en niet in de factory.
