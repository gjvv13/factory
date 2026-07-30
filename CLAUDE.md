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
- `factory/eslint` — de afdwingbare helft van `CODING_GUIDELINES.md`
- `factory/prettier` — opmaak
- `factory/vitest-unit`, `factory/vitest-contract`, `factory/vitest-e2e` — testpresets

**Het proces**: `templates/`, de slash commands, en `CODING_GUIDELINES.md`.

**Het skeleton** (`skeleton/`): het startpunt van een nieuwe applicatie, met een
werkende backend, drie omgevingen en een compleet testfundament. Placeholders
(`{{APP_NAAM}}`, `{{PORT_DEV}}`, …) worden door `factory nieuw` ingevuld.
Dubbele accolades en geen onderstrepingen: dat laatste leest markdown als
vetgedrukt, waardoor prettier de placeholder zou omschrijven.

## De pipeline

| Stap          | Commando                             | Waar             |
| ------------- | ------------------------------------ | ---------------- |
| 1. Backlog    | `/idee <beschrijving>`               | hier             |
| 2. Refinement | `/refine <app> <id>`                 | hier             |
| 3. Bouwen     | `/bouw <id> <slice>`                 | in de applicatie |
| 4. Testen     | `pnpm verify`                        | in de applicatie |
| 5. Releasen   | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 6. Promoveren | `pnpm promote acc\|prod [tag]`       | in de applicatie |

`/status` geeft het overzicht over de backlog en alle applicaties.

De **backlog staat centraal** in deze repo, met een map per applicatie plus een
map `factory/` voor verbeteringen aan de pipeline zelf. Groomen doe je hier,
bouwen doe je in de applicatie. Zo zit je altijd in de repo die je verandert.

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
"devDependencies": { "factory": "github:gjvv13/factory#v1.0.3" }
```

Een verbetering aan de pipeline bereikt een applicatie door hier te releasen en
daar de versie te bumpen. Slash commands en de git hook moeten fysiek in de
app-repo staan; die haal je op met `factory sync`.

Drie soorten bestanden kunnen niet uit `node_modules` komen, omdat Claude Code,
git en GitHub Actions ze op een vaste plek in de repo verwachten: de slash
commands, de pre-commit hook en `.github/workflows/ci.yml`. Die staan hier in
`claude-commands/`, `hooks/` en `workflows/`, en `factory sync` zet ze in een
applicatie gelijk aan deze repo.

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
