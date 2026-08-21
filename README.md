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

| Stap           | Commando                             | Waar             |
| -------------- | ------------------------------------ | ---------------- |
| 1. Backlog     | `/idee <beschrijving>`               | hier (factory)   |
| 2. Functioneel | `/functioneel <issue#>`              | hier (factory)   |
| 3. Technisch   | `/refine <issue#>`                   | hier (factory)   |
| 4. Akkoord     | → kolom **Klaar voor Bouwen**        | hier (factory)   |
| 5. Bouwen      | `/bouw <issue#>`                     | in de applicatie |
| 6. Testen      | `pnpm verify`                        | in de applicatie |
| 7. Releasen    | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 8. Promoveren  | `pnpm promote acc\|prod [tag]`       | in de applicatie |

Stap 2 legt vast **wat** het moet doen, stap 3 **hoe** — die knip maakt de
technische uitwerking uitbesteedbaar aan een onbemande werker, terwijl de intentie
en het akkoord bij jou blijven.

Groomen (idee, functioneel, refine) doe je hier; bouwen doe je in de
applicatie-repo. `/status` geeft het overzicht over de backlog en alle applicaties.

## Eén backlog voor alles

De backlog van álle applicaties is **één set GitHub Issues** in `gjvv13/factory`,
met per issue het `App`-veld (welke app) en de kolom `Status` (waar het in de pijplijn
staat) — beide velden op het board, geen labels — plus een `type:`-label (epic, task of
bug). De grote brokken (epics) volg je op het board, je dagelijkse lijst zijn de bugs en
klusjes. De volledige werkwijze staat
in [`WORKFLOW.md`](WORKFLOW.md).

## De CLI

Elke applicatie krijgt de `factory`-CLI mee als devDependency:

| Commando                                          | Wat het doet                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `factory verify [--snel]`                         | Kwaliteitspoort: opmaak, lint, types, unit, contract, e2e, build         |
| `factory release [patch\|minor\|major]`           | Verify (incl. dekkingspoort), versie verhogen, committen, taggen, pushen |
| `factory promote <acc\|prod> [tag]`               | Tag uitrollen, migreren, herstarten, gezondheid controleren              |
| `factory deploy <acc\|prod>`                      | Uitrol-orchestratie voor de runner: `acc` = release + promote acc        |
| `factory env <status\|start\|stop\|reload\|logs>` | Omgevingen bedienen via pm2; `reload` herlaadt de env-bestanden vers     |
| `factory flag <omgeving> [naam] [on\|off]`        | Feature flags omzetten zonder deploy                                     |
| `factory nieuw <naam>`                            | Nieuwe applicatie uit het skelet, met een vrij poortblok                 |
| `factory sync`                                    | Slash commands, git hook en CI-workflow gelijkzetten aan deze repo       |
| `factory opruimen [--dry]`                        | Gemergede branches opruimen: lokaal en op de remote                      |

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
omgevingen en een compleet testfundament, kent een vrij poortblok toe en voegt de
app toe als optie in het `App`-veld op de backlog (een kolom op het board, geen
label). Daarna: koppelen via `factory.json` en
de factory als devDependency op een tag, precies zoals `assistant` en `beheer`
dat doen.

## Meer weten

- [`WORKFLOW.md`](WORKFLOW.md) — de backlog- en pipeline-werkwijze over de repo's heen
- [`CLAUDE.md`](CLAUDE.md) — hoe de factory intern in elkaar zit en hoe je eraan werkt
- [`skills/coding-guidelines/SKILL.md`](skills/coding-guidelines/SKILL.md) — de coding guidelines en de definition of done die voor elke app gelden
