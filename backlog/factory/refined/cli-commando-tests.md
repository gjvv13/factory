---
id: cli-commando-tests
titel: Tests voor de factory-CLI-commando's
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Tests voor de factory-CLI-commando's

## Samenvatting

De CLI-commando's die deployen, releasen en in andere repo's schrijven krijgen
tests. Daarvoor wordt de shell-laag (`src/shell.ts`) injecteerbaar gemaakt, zodat
commando's getest kunnen worden zonder echt `git`, `pnpm` of `pm2` aan te roepen.
`nieuw` en `sync` krijgen daarnaast een integratietest tegen een echte tijdelijke
map.

## Functionele architectuur

### Gedrag

Geen zichtbaar nieuw gedrag voor de gebruiker; dit is een kwaliteits- en
vangnetslice. Wel getest gedrag:

- `promote` roept de stappen in de juiste volgorde aan en stopt bij de eerste fout.
- `nieuw` vervangt tokens correct, kiest een vrij poortblok en botst niet met
  bestaande apps.
- `sync` kopieert precies de vier soorten bestanden en meldt wat er wijzigde.
- `release` verhoogt de versie, commit, tagt en pusht in de juiste volgorde.

### Regels en randgevallen

- Een falende stap in `promote`/`release` breekt de rest af (geen halve deploy).
- `nieuw` met een al bestaande naam of een botsend poortblok faalt met een
  `GebruikersFout`.
- `sync` in een niet-app-map faalt met de bestaande melding.

### Wat het expliciet níet doet

- Geen echte deploy, push of pm2-aanroep in de tests.
- Geen 100%-dekkingsdoel; de drempel komt uit [[coverage-in-verify]].

## Technische architectuur

### Onderdelen

| Laag     | Bestand                                     | Wat er verandert                                                                                  |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| shell    | `src/shell.ts`                              | `run`/`git`/`uitvoerVan` achter een injecteerbare uitvoerder, of een test-hook om ze te vervangen |
| commands | `src/commands/*.ts`                         | zo nodig kleine aanpassingen zodat ze de injecteerbare shell gebruiken                            |
| test     | `test/{promote,release,nieuw,sync}.test.ts` | nieuw                                                                                             |

### Datamodel

Geen.

### Externe koppelingen

Geen. Het punt is juist die koppelingen (git/pnpm/pm2) af te vangen in de test.

### Feature flag

Geen.

## Slices

### Slice 1 — Injecteerbare shell + unit-tests voor nieuw en sync

- **Doel:** `shell.ts` is af te vangen in tests; `nieuw` en `sync` (puur
  bestands-/tekstwerk) zijn gedekt.
- **Acceptatiecriteria:**
  - [x] Commando's roepen externe processen via één injecteerbaar punt aan.
  - [x] `nieuw`: tokenvervanging, poortallocatie en botsing zijn getest (draai in
        een tijdelijke map).
  - [x] `sync`: kopieert de vier soorten, meldt wijzigingen, faalt buiten een app.
- **Tests:** unit: sync/nieuw met gemockte shell · integratie: `nieuw` in een
  temp-map · e2e: n.v.t.
- **Flag:** geen

### Slice 2 — Unit-tests voor promote en release

- **Doel:** de volgorde en foutafbreking van de gevaarlijkste commando's zijn
  vastgelegd, inclusief het vangnet uit [[promote-vangnet]].
- **Acceptatiecriteria:**
  - [ ] `promote`: juiste volgorde, stopt bij eerste fout, rollback-pad getest.
  - [ ] `release`: versie-bump/commit/tag/push in de juiste volgorde met gemockte
        git.
- **Tests:** unit met gemockte shell · e2e: n.v.t.
- **Flag:** geen

## Risico's

- **Te veel mocken test de mock, niet de code.** Daarom voor `nieuw` een echte
  integratietest tegen een tijdelijke map, en voor de rest alleen de volgorde en
  foutpaden afvangen — niet elk git-detail.
- **Refactor van `shell.ts` raakt alle commando's.** Klein houden: één
  injectiepunt, geen bredere herstructurering.

## Besluiten

- **Injecteerbare shell boven zware mock-frameworks.** Eén punt waar
  `run`/`git`/`pm2` doorheen gaan, in de test vervangen door een opnemer. Past bij
  de bestaande stijl (kleine, pure modules) en houdt de commando's leesbaar.
- **`nieuw` krijgt een echte integratietest.** Tokenvervanging en poortallocatie
  zijn precies het soort logica dat een mock zou wegabstraheren; een run in een
  temp-map geeft echt vertrouwen.
