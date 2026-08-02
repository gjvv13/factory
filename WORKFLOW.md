# Werkwijze: één backlog in GitHub Issues

De backlog van álle applicaties leeft als **GitHub Issues in `gjvv13/factory`** —
één plek, over de repo's heen. Dit bestand is de bron van waarheid voor het proces
en geldt voor elke applicatie in het ecosysteem.

## Waarom hier

De factory is de gedeelde, centrale repo (elke app haalt hem als devDependency
binnen). Grooming hoort centraal; bouwen hoort in de applicatie. Door de backlog
in de factory-issues te zetten, blijft er één overzicht terwijl elke app zijn eigen
code-repo houdt.

## Labels

Elk issue draagt drie soorten labels:

- **`app:<naam>`** — bij welke applicatie het hoort: `app:assistant`, `app:beheer`,
  `app:factory`. (Een nieuwe app krijgt zijn `app:`-label automatisch van `factory nieuw`.)
- **`status:<fase>`** — waar het in de pijplijn zit: `status:idea` (ruw),
  `status:refined` (uitgewerkt, klaar om te bouwen), `status:done` (afgerond).
- **`type:<soort>`** — wat voor werk het is: `type:epic` (grote, meerdere-slices
  functionaliteit), `type:task` (klus, chore, kleine verbetering), `type:bug` (defect).

### Epics vs. klein werk — twee lagen

De grote brokken (`type:epic`) hoef je niet dagelijks te zien; die volg je op het
board. Je **dagelijkse werk-lijst** is een gefilterde issue-weergave zónder epics:

- Bugs + klusjes (geen epics): `is:issue is:open -label:type:epic`
- Alleen bugs: `is:issue is:open label:type:bug`
- Alleen de epics: `is:issue is:open label:type:epic`

### Eerst zoeken, dan aanmaken

Voordat je een nieuw issue aanmaakt, controleer je of het al bestaat — open óf
gesloten: `gh issue list -R gjvv13/factory --search "<kernwoorden>" --state all`.
Bestaat het al, vul dan dat issue aan in plaats van een duplicaat te maken. Zo
blijft de backlog één-op-één met het werk.

### Beslissingen horen in de epic, niet op de lijst

Een nog-te-nemen beslissing wordt **geen los issue**. Zet 'm als een
"Open beslissingen"-regel (checklist) in de body van de epic waar hij bij hoort. Zo
blijft de issue-lijst schoon en staat de keuze bij het onderwerp.

## Board

Eén board bundelt alles: **"Backlog — alle applicaties"**
(https://github.com/users/gjvv13/projects/2). Filter op `app:` voor één applicatie,
`status:` voor een fase, of `type:` voor epics vs. klein werk.

## De pijplijn

| Stap          | Commando                 | Waar             | Wat er met het issue gebeurt                                      |
| ------------- | ------------------------ | ---------------- | ----------------------------------------------------------------- |
| 1. Idee       | `/idee <beschrijving>`   | factory          | Nieuw issue, labels `app:<naam>` + `type:<soort>` + `status:idea` |
| 2. Refinement | `/refine <issue#>`       | factory          | Body uitgewerkt; label `status:idea` → `status:refined`           |
| 3. Bouwen     | `/bouw <issue#> <slice>` | in de applicatie | Slice bouwen; acceptatiecriteria afvinken in het issue            |
| 4. Testen     | `pnpm verify`            | in de applicatie | —                                                                 |
| 5. Releasen   | `pnpm release`           | in de applicatie | —                                                                 |
| 6. Promoveren | `pnpm promote`           | in de applicatie | Bij afronding: `status:refined` → `status:done`, issue sluiten    |

`/status` geeft het overzicht via `gh issue list` (per `app:` en `status:`).

## Grooming vs. bouwen

Groomen (idee, refine) doe je in factory; bouwen doe je in de applicatie-repo.
Omdat alle issues in `gjvv13/factory` staan, werkt `/bouw` vanuit elke app met
`gh issue view <nummer> -R gjvv13/factory`.

## Gereedschap

Alles loopt via de `gh` CLI (ingelogd als `gjvv13`). Issues worden met
`--body-file` en de labels hierboven aangemaakt en bijgewerkt.
