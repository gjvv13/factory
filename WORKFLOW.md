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

Elk issue draagt twee soorten labels:

- **`app:<naam>`** — bij welke applicatie het hoort: `app:assistant`, `app:beheer`,
  `app:factory`. (Nieuwe app → nieuw `app:`-label.)
- **`status:<fase>`** — waar het in de pijplijn zit: `status:idea` (ruw),
  `status:refined` (uitgewerkt, klaar om te bouwen), `status:done` (afgerond).

## Board

Eén board bundelt alles: **"Backlog — alle applicaties"**
(https://github.com/users/gjvv13/projects/2). Filter op `app:` voor één applicatie,
op `status:` voor een fase.

## De pijplijn

| Stap          | Commando                 | Waar             | Wat er met het issue gebeurt                                   |
| ------------- | ------------------------ | ---------------- | -------------------------------------------------------------- |
| 1. Idee       | `/idee <beschrijving>`   | factory          | Nieuw issue, labels `app:<naam>` + `status:idea`               |
| 2. Refinement | `/refine <issue#>`       | factory          | Body uitgewerkt; label `status:idea` → `status:refined`        |
| 3. Bouwen     | `/bouw <issue#> <slice>` | in de applicatie | Slice bouwen; acceptatiecriteria afvinken in het issue         |
| 4. Testen     | `pnpm verify`            | in de applicatie | —                                                              |
| 5. Releasen   | `pnpm release`           | in de applicatie | —                                                              |
| 6. Promoveren | `pnpm promote`           | in de applicatie | Bij afronding: `status:refined` → `status:done`, issue sluiten |

`/status` geeft het overzicht via `gh issue list` (per `app:` en `status:`).

## Grooming vs. bouwen

Groomen (idee, refine) doe je in factory; bouwen doe je in de applicatie-repo.
Omdat alle issues in `gjvv13/factory` staan, werkt `/bouw` vanuit elke app met
`gh issue view <nummer> -R gjvv13/factory`.

## Gereedschap

Alles loopt via de `gh` CLI (ingelogd als `gjvv13`). Issues worden met
`--body-file` en de labels hierboven aangemaakt en bijgewerkt.
