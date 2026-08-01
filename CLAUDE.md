# Software factory

De pipeline van idee tot productie, en het gereedschap waarmee de applicaties
gebouwd worden. De applicaties zelf staan in eigen repositories naast deze map.

```
~/Documents/Software/
├── factory/      deze repo: proces, backlog, CLI, gedeelde configuratie
└── assistant/    eerste applicatie (WhatsApp-backend)
```

## Wat deze repo levert

**Een CLI** (`factory`) die elke applicatie als devDependency binnenhaalt:

| Commando                                   | Wat het doet                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `factory verify [--snel]`                  | Kwaliteitspoort: opmaak, lint, types, unit, contract, e2e, build              |
| `factory release [patch\|minor\|major]`    | Verify, versie verhogen, committen, taggen, pushen                            |
| `factory promote <acc\|prod> [tag]`        | Tag uitrollen, migreren, herstarten, gezondheid controleren                   |
| `factory env <status\|start\|stop\|logs>`  | Omgevingen bedienen via pm2                                                   |
| `factory flag <omgeving> [naam] [on\|off]` | Feature flags omzetten zonder deploy                                          |
| `factory nieuw <naam>`                     | Nieuwe applicatie uit het skeleton, met een vrij poortblok                    |
| `factory sync`                             | Slash commands, git hook en CI-workflow in een app gelijkzetten aan deze repo |

`verify` draait de scripts uit de `package.json` van de applicatie, in een vaste
volgorde, en slaat over wat er niet is. Daardoor werkt dezelfde poort in deze
repo (die geen e2e-tests heeft) en in een applicatie (die ze wel heeft).

**Gedeelde configuratie**, geïmporteerd uit het pakket:

- `factory/tsconfig.base.json` — strikte TypeScript-instellingen
- `factory/eslint` — de afdwingbare helft van de coding guidelines
- `factory/prettier` — opmaak
- `factory/vitest-unit`, `factory/vitest-contract`, `factory/vitest-e2e` — testpresets

**Het proces**: `templates/`, de slash commands, en de `coding-guidelines`-skill
(`skills/coding-guidelines/SKILL.md`) — de niet-afdwingbare helft van de regels,
die Claude Code in een applicatie zelf laadt zodra er code ontstaat.

**Het skeleton** (`skeleton/`): het startpunt van een nieuwe applicatie, met een
werkende backend, drie omgevingen en een compleet testfundament. Placeholders
(`{{APP_NAAM}}`, `{{PORT_DEV}}`, …) worden door `factory nieuw` ingevuld.
Dubbele accolades en geen onderstrepingen: dat laatste leest markdown als
vetgedrukt, waardoor prettier de placeholder zou omschrijven.

## De pipeline

| Stap          | Commando                             | Waar             |
| ------------- | ------------------------------------ | ---------------- |
| 1. Backlog    | `/idee <beschrijving>`               | hier             |
| 2. Refinement | `/refine <issue#>`                   | hier             |
| 3. Bouwen     | `/bouw <issue#> <slice>`             | in de applicatie |
| 4. Testen     | `pnpm verify`                        | in de applicatie |
| 5. Releasen   | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 6. Promoveren | `pnpm promote acc\|prod [tag]`       | in de applicatie |

`/status` geeft het overzicht over de backlog en alle applicaties.

De **backlog is één set GitHub Issues** in `gjvv13/factory`, met een label
`app:<naam>` per applicatie en `status:idea|refined|done` per fase — zie
[`WORKFLOW.md`](WORKFLOW.md). Groomen doe je hier, bouwen doe je in de applicatie.
De oude bestand-backlog in `backlog/` is hiernaar gemigreerd en kan opgeruimd
worden (samen met de `backlog`-verwijzing in elke `factory.json`).

## Een applicatie koppelen

Een applicatie heeft twee dingen: een `factory.json` met naam, poorten en paden,
en de factory als devDependency op een tag.

```json
{
  "naam": "assistant",
  "poorten": { "dev": 3001, "acc": 3002, "prod": 3000 },
  "envRoot": "~/AppEnvs/assistant",
  "backlog": "../factory/backlog/assistant"
}
```

```json
"devDependencies": { "factory": "git+https://github.com/gjvv13/factory.git#v1.0.4" }
```

Schrijf de koppeling als `git+https://…` en niet als de verkorting
`github:gjvv13/factory`. pnpm zet die verkorting in de lockfile om naar een
ssh-URL, en een CI-runner heeft geen sleutel: dan kan de build de factory niet
ophalen. Deze repo is daarom publiek — er staat geen enkel geheim in, alleen de
pipeline en een generiek skelet.

Een verbetering aan de pipeline bereikt een applicatie door hier te releasen en
daar de versie te bumpen. Slash commands en de git hook moeten fysiek in de
app-repo staan; die haal je op met `factory sync`.

Vier soorten bestanden kunnen niet uit `node_modules` komen, omdat Claude Code,
git en GitHub Actions ze op een vaste plek in de repo verwachten: de slash
commands, de skills, de pre-commit hook en `.github/workflows/ci.yml`. Die staan
hier in `claude-commands/`, `skills/`, `hooks/` en `workflows/`, en `factory sync`
zet ze in een applicatie gelijk aan deze repo. De factory gebruikt de skills zelf
via een symlink in `.claude/skills/`, zodat de regels ook voor haar eigen code
gelden zonder een tweede kopie.

## Ontwikkelen aan de factory zelf

```bash
pnpm verify                  # lint, types, unit tests, build
factory nieuw proefapp --link  # test de generator met een lokale koppeling
```

Met `--link` krijgt de nieuwe applicatie `link:../factory` in plaats van de
git-tag, zodat je wijzigingen direct doorwerken zonder te releasen.

`dist/` staat bewust in versiebeheer. Applicaties halen de factory als
git-dependency binnen, en pnpm weigert daar een buildstap te draaien zonder
toestemming die je per commit-hash zou moeten vastleggen — dat breekt bij elke
release. Door de gebouwde CLI mee te leveren is het pakket direct bruikbaar.
De pre-commit hook bouwt en stageert `dist/`, zodat de build nooit uit de pas
loopt met de bron.

TypeScript staat op 6.0.x: typescript-eslint ondersteunt TS 7 nog niet.
