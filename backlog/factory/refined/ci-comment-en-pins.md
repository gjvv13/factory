---
id: ci-comment-en-pins
titel: Stale CI-comment en bleeding-edge toolchain-pins
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Stale CI-comment en bleeding-edge toolchain-pins

## Samenvatting

De verouderde "node24"-comment in de CI-workflow wordt gecorrigeerd naar de
werkelijkheid (`.nvmrc` = 22), en de bewuste, risicovolle versie-pins van de
toolchain krijgen een korte, expliciete uitleg met de voorwaarde waaronder ze
opgetrokken mogen worden.

## Functionele architectuur

### Gedrag

Geen runtime-gedrag. Wel: wie de CI of `package.json` leest, ziet kloppende
comments en begrijpt waarom een pin er staat en wanneer hij weg mag.

### Regels en randgevallen

- De CI draait op de node-versie uit `.nvmrc` (22). De comment mag geen andere
  major suggereren.
- De pin-uitleg noemt per bewuste pin de reden en de opheffingsvoorwaarde (bijv.
  "TypeScript op 6.0.x tot typescript-eslint TS 7 ondersteunt").

### Wat het expliciet níet doet

- Trekt de versies nu niet op (dat blijft een bewuste keuze op het moment dat het
  veilig is).
- Voegt geen automatische dependency-bot toe.

## Technische architectuur

### Onderdelen

| Laag      | Bestand                             | Wat er verandert                                                 |
| --------- | ----------------------------------- | ---------------------------------------------------------------- |
| workflows | `workflows/ci.yml`                  | de node24-comment corrigeren of verwijderen                      |
| docs      | `CLAUDE.md`                         | de bewuste pins + opheffingsvoorwaarden op één plek documenteren |
| skeleton  | `skeleton/.github/workflows/ci.yml` | zelfde comment-fix als die daar staat                            |

### Datamodel

Geen.

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — Comment fixen en pins documenteren

- **Doel:** kloppende CI-comment en een korte, vindbare uitleg van de bewuste pins.
- **Acceptatiecriteria:**
  - [ ] De node24-comment in `workflows/ci.yml` (en het skeleton) klopt met
        `.nvmrc`.
  - [ ] `CLAUDE.md` benoemt de bewuste pins (TS 6.0.x, eslint 10, @types/node 26,
        vitest 4) met reden en opheffingsvoorwaarde.
  - [ ] Na `factory sync` staat de gecorrigeerde CI in de apps.
- **Tests:** n.v.t.
- **Flag:** geen

## Risico's

- **De pins zijn en blijven bleeding-edge.** Dit item verkleint het risico niet,
  het maakt het zichtbaar. Of we conservatiever willen pinnen is een aparte,
  bredere afweging die hier bewust buiten valt.

## Besluiten

- **Documenteren, niet nu optrekken.** De pins zijn bewust; het probleem is dat
  het risico impliciet is. Eén slice, puur tekst/config.
- **De opheffingsvoorwaarde per pin opschrijven** zodat een latere bump een
  duidelijke trigger heeft in plaats van giswerk.
