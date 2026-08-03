# Software factory

Dit is het hart van een klein ecosysteem van eigen applicaties: het proces van
idee tot productie, de CLI die dat proces uitvoert, en de gedeelde configuratie
en het skelet waarmee elke applicatie gebouwd wordt. De applicaties zelf staan in
eigen repositories naast deze map.

```
~/Documents/Software/
├── factory/      deze repo: proces, CLI, gedeelde configuratie, skelet
├── assistant/    gezinsassistent — één backend, meerdere kanalen (o.a. WhatsApp)
└── beheer/       beheerconsole — health en feature flags van álle apps op één plek
```

Elke applicatie haalt deze repo als devDependency binnen op een vaste tag. De
factory is daarom publiek: er staat geen enkel geheim in, alleen de pipeline en
een generiek skelet.

## De applicaties

| App                         | Poorten (dev/acc/prod) | Waarvoor                                                             |
| --------------------------- | ---------------------- | -------------------------------------------------------------------- |
| [`assistant`](../assistant) | 3001 / 3002 / 3000     | Kanaalonafhankelijke assistent; berichten in, commando's uit         |
| [`beheer`](../beheer)       | 3011 / 3012 / 3010     | Console dat de andere apps kent: hun health toont en hun flags omzet |

`beheer` kent de andere apps via zijn eigen `apps.json`-register — voeg daar een
app toe en de console neemt hem mee in het overzicht en de flag-bediening.

## De pipeline

| Stap          | Commando                             | Waar             |
| ------------- | ------------------------------------ | ---------------- |
| 1. Backlog    | `/idee <beschrijving>`               | hier (factory)   |
| 2. Refinement | `/refine <issue#>`                   | hier (factory)   |
| 3. Bouwen     | `/bouw <issue#> <slice>`             | in de applicatie |
| 4. Testen     | `pnpm verify`                        | in de applicatie |
| 5. Releasen   | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 6. Promoveren | `pnpm promote acc\|prod [tag]`       | in de applicatie |

Groomen (idee, refine) doe je hier; bouwen doe je in de applicatie-repo.
`/status` geeft het overzicht over de backlog en alle applicaties.

## Eén backlog voor alles

De backlog van álle applicaties is **één set GitHub Issues** in `gjvv13/factory`,
met per issue een `app:<naam>`-label (welke app), een `status:`-label (fase) en
een `type:`-label (epic, task of bug). De grote brokken (epics) volg je op het
board, je dagelijkse lijst zijn de bugs en klusjes. De volledige werkwijze staat
in [`WORKFLOW.md`](WORKFLOW.md).

## De CLI

Elke applicatie krijgt de `factory`-CLI mee als devDependency:

| Commando                                   | Wat het doet                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `factory verify [--snel]`                  | Kwaliteitspoort: opmaak, lint, types, unit, contract, e2e, build         |
| `factory release [patch\|minor\|major]`    | Verify (incl. dekkingspoort), versie verhogen, committen, taggen, pushen |
| `factory promote <acc\|prod> [tag]`        | Tag uitrollen, migreren, herstarten, gezondheid controleren              |
| `factory env <status\|start\|stop\|logs>`  | Omgevingen bedienen via pm2                                              |
| `factory flag <omgeving> [naam] [on\|off]` | Feature flags omzetten zonder deploy                                     |
| `factory nieuw <naam>`                     | Nieuwe applicatie uit het skelet, met een vrij poortblok                 |
| `factory sync`                             | Slash commands, git hook en CI-workflow gelijkzetten aan deze repo       |

De volledige `factory verify` meet ook testdekking. Zet een app een
`dekkingsMinimum` in zijn `factory.json`, dan is dat een **release-poort**: de
gecombineerde dekking — unit + contract + e2e, samengevoegd tot één cijfer — moet
de drempel halen, anders faalt verify en ontstaat er geen release-tag. Zo bereikt
code onder de drempel de productie niet, want `promote` rolt alleen bestaande tags
uit. Zie [`CLAUDE.md`](CLAUDE.md) voor hoe het cijfer tot stand komt.

## Een nieuwe applicatie beginnen

```bash
factory nieuw <naam>
```

Dit maakt een nieuwe repo uit het skelet met een werkende backend, drie
omgevingen en een compleet testfundament, kent een vrij poortblok toe en maakt
het `app:<naam>`-label op de backlog aan. Daarna: koppelen via `factory.json` en
de factory als devDependency op een tag, precies zoals `assistant` en `beheer`
dat doen.

## Meer weten

- [`WORKFLOW.md`](WORKFLOW.md) — de backlog- en pipeline-werkwijze over de repo's heen
- [`CLAUDE.md`](CLAUDE.md) — hoe de factory intern in elkaar zit en hoe je eraan werkt
- [`CODING_GUIDELINES.md`](CODING_GUIDELINES.md) — de coding guidelines die voor elke app gelden
