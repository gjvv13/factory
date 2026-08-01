---
id: prettier-duplicatie
titel: Dubbele prettier-config opheffen
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Dubbele prettier-config opheffen

## Samenvatting

De factory heeft twee kopieën van de prettier-config: `configs/prettier.json` (de
bron, geëxporteerd als `factory/prettier`) en een byte-identieke `.prettierrc.json`
voor de factory zelf. We laten de factory haar eigen prettier-config uit de
pakket-export lezen — precies zoals het skeleton al doet (`.prettierrc.json` =
`"factory/prettier"`) en zoals de factory het voor eslint al doet — zodat er nog
één bron is.

## Functionele architectuur

### Gedrag

Geen zichtbaar gedrag; de opmaak blijft identiek. Het verschil is dat er nog maar
één plek is waar de prettier-regels staan.

### Regels en randgevallen

- `prettier --check .` en `--write .` blijven exact hetzelfde formatteren.
- De export `factory/prettier` (die de apps gebruiken) blijft ongewijzigd.

### Wat het expliciet níet doet

- Verandert geen opmaakregels.
- Raakt de eslint- of tsconfig-exports niet.

## Technische architectuur

### Onderdelen

| Laag    | Bestand                 | Wat er verandert                                                                                                                               |
| ------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| configs | `.prettierrc.json`      | inhoud vervangen door de verwijzing `"factory/prettier"` (self-reference via `exports`), of verwijderen als prettier de config anders resolvet |
| configs | `configs/prettier.json` | blijft de enige bron                                                                                                                           |

### Datamodel

Geen.

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — Eén bron voor prettier

- **Doel:** de factory leest haar prettier-config uit de export; de losse kopie is
  weg.
- **Acceptatiecriteria:**
  - [ ] `.prettierrc.json` bevat geen gedupliceerde waarden meer maar verwijst
        naar `factory/prettier` (of is verwijderd als resolutie dat toelaat).
  - [ ] `pnpm format:check` slaagt en formatteert identiek als voorheen.
  - [ ] `configs/prettier.json` is de enige plek met de waarden.
- **Tests:** n.v.t. (config); handmatig `format:check` draaien.
- **Flag:** geen

## Risico's

- **Prettier kan de self-reference mogelijk niet resolven** binnen de factory zelf
  (Node self-referencing via `exports` werkt, maar prettier's config-resolver moet
  het ook accepteren). Zo niet, dan is de terugval: `.prettierrc.json` weghalen en
  vertrouwen op de default-resolutie, of een minimale `.prettierrc.cjs` die
  `require('./configs/prettier.json')` re-exporteert. Uit te proberen in de slice.

## Besluiten

- **De export als enige bron**, net als bij eslint. Het skeleton doet dit al met
  `"factory/prettier"`; de factory hoort haar eigen regels net zo te consumeren
  (dogfooding) in plaats van een handmatig te synchroniseren kopie te houden.
- **Kwartierwerk, één slice.** De enige echte vraag is de resolutie-manier; die
  test je in de slice zelf.
