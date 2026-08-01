---
id: readme-per-repo
titel: README per repo en factory-docs die beheer kennen
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# README per repo en factory-docs die beheer kennen

## Samenvatting

Elke repo krijgt een korte `README.md` voor een mens. Het skeleton krijgt een
README-template zodat nieuwe apps er meteen mee starten; de drie bestaande repos
(factory, assistant, beheer) krijgen eenmalig handmatig een README. Tegelijk wordt
`factory/CLAUDE.md` bijgewerkt zodat het `beheer` kent.

## Functionele architectuur

### Gedrag

Geen runtime-gedrag; dit is documentatie. Een README bevat: wat is dit, hoe start
je het lokaal, en waar staat de rest (verwijzing naar de factory voor pipeline,
guidelines en backlog). CLAUDE.md blijft de gedetailleerde bron voor Claude; de
README is de korte instap voor een mens.

### Regels en randgevallen

- De README dubbelt niet met CLAUDE.md: hij verwijst ernaar in plaats van de
  inhoud te kopiëren (kopiëren is precies wat de doc-drift veroorzaakte, zie
  [[beheer-docs-kloppend]]).
- Het skeleton-template gebruikt dezelfde placeholders als de rest
  (`{{APP_NAAM}}`, `{{PORT_DEV}}`), zodat `factory nieuw` ze invult.

### Wat het expliciet níet doet

- Geen automatische generatie uit `factory.json` (bewust; zie Besluiten).
- Geen uitgebreide architectuurdocs/ADR's — alleen een instap-README.

## Technische architectuur

### Onderdelen

| Laag     | Bestand                                         | Wat er verandert                                                                                             |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| skeleton | `skeleton/README.md` (nieuw)                    | README-template met placeholders                                                                             |
| commands | `src/commands/nieuw.ts`                         | controleren dat de README meekopieert en tokens ingevuld worden (bestaat al voor de boom; alleen verifiëren) |
| docs     | `README.md` (factory)                           | eenmalig handmatig                                                                                           |
| docs     | `CLAUDE.md` (factory)                           | `beheer` toevoegen aan het diagram/tekst                                                                     |
| docs     | `../assistant/README.md`, `../beheer/README.md` | eenmalig handmatig                                                                                           |

### Datamodel

Geen.

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — Skeleton-template + factory-docs

- **Doel:** nieuwe apps starten met een README; de factory heeft een README en
  een kloppende CLAUDE.md.
- **Acceptatiecriteria:**
  - [ ] `skeleton/README.md` bestaat met placeholders en wordt door `factory
nieuw` ingevuld.
  - [ ] De factory heeft een `README.md`.
  - [ ] `factory/CLAUDE.md` noemt `beheer` (diagram + waar relevant).
- **Tests:** dekt [[cli-commando-tests]] al (nieuw vult tokens in); hier geen
  aparte test nodig.
- **Flag:** geen

### Slice 2 — README voor de bestaande apps

- **Doel:** assistant en beheer hebben elk een README.
- **Acceptatiecriteria:**
  - [ ] `../assistant/README.md` en `../beheer/README.md` bestaan en kloppen met
        de echte app (voor beheer: geen assistant-inhoud, zie
        [[beheer-docs-kloppend]]).
- **Tests:** n.v.t.
- **Flag:** geen

## Risico's

- **README's lopen weer uit de pas** (het oorspronkelijke probleem). Mitigatie: de
  README kort houden en naar CLAUDE.md/factory verwijzen i.p.v. te dupliceren.

## Besluiten

- **Skeleton-template + handmatig**, conform de keuze in refinement. Genereren uit
  `factory.json` is zelfonderhoudend maar meer machinerie dan een instap-README
  rechtvaardigt; een korte, verwijzende README loopt nauwelijks uit de pas.
- **Dit hangt samen met [[beheer-docs-kloppend]]:** die fixt de foute CLAUDE.md
  van beheer; dit voegt de README-laag en de factory-doc-update toe.
