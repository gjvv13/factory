# Software factory

De pipeline van idee tot productie, en het gereedschap waarmee de applicaties
gebouwd worden. De applicaties zelf staan in eigen repositories naast deze map.

```
~/Documents/Software/
├── factory/      deze repo: proces, CLI, gedeelde configuratie
├── assistant/    gezinsassistent (kanaalonafhankelijke backend, o.a. WhatsApp)
└── beheer/       beheerconsole over de apps heen (health + feature flags)
```

## Wat deze repo levert

**Een CLI** (`factory`) die elke applicatie als devDependency binnenhaalt:

| Commando                                          | Wat het doet                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `factory verify [--snel]`                         | Kwaliteitspoort: opmaak, lint, types, unit, contract, e2e, build              |
| `factory inleveren [--titel=<t>]`                 | Poort draaien, branch pushen, PR openen en in de merge-queue/wachtrij zetten  |
| `factory integreer`                               | De factory-wachtrij afwerken (private apps zonder GitHub merge-queue)         |
| `factory release [patch\|minor\|major]`           | Verify (incl. dekkingspoort), versie verhogen, committen, taggen, pushen      |
| `factory promote <acc\|prod> [tag]`               | Tag uitrollen, migreren, herstarten, gezondheid controleren                   |
| `factory deploy <acc\|prod>`                      | Uitrol-orchestratie voor de runner: `acc` = release + promote acc             |
| `factory env <status\|start\|stop\|reload\|logs>` | Omgevingen bedienen via pm2; `reload` herlaadt de env-bestanden vers          |
| `factory flag <omgeving> [naam] [on\|off]`        | Feature flags omzetten zonder deploy                                          |
| `factory nieuw <naam>`                            | Nieuwe applicatie uit het skeleton, met een vrij poortblok                    |
| `factory sync`                                    | Slash commands, git hook en CI-workflow in een app gelijkzetten aan deze repo |

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

| Stap           | Commando                             | Waar             |
| -------------- | ------------------------------------ | ---------------- |
| 1. Backlog     | `/idee <beschrijving>`               | hier             |
| 2. Functioneel | `/functioneel <issue#>`              | hier             |
| 3. Technisch   | `/refine <issue#>`                   | hier             |
| 4. Akkoord     | label naar `status:refined`          | hier             |
| 5. Bouwen      | `/bouw <issue#> <slice>`             | in de applicatie |
| 6. Testen      | `pnpm verify`                        | in de applicatie |
| 7. Releasen    | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 8. Promoveren  | `pnpm promote acc\|prod [tag]`       | in de applicatie |

Stap 2 legt vast **wat** het moet doen (dat weet alleen jij), stap 3 **hoe** (dat
volgt uit de code). Die knip maakt stap 3 uitbesteedbaar aan een onbemande werker
zonder dat een idee ooit ongezien code wordt; het staatlabel is de riem. Voor kleine
`type:task`- en `type:bug`-items mag stap 2 overgeslagen worden: `/refine` op een
`status:idea`-item doet beide helften in één keer.

`/status` geeft het overzicht over de backlog en alle applicaties.

De **backlog is één set GitHub Issues** in `gjvv13/factory`, met het `App`-veld
(een kolom op het board) per applicatie en het label
`status:idea|functioneel|technisch|refined|done` per fase — zie
[`WORKFLOW.md`](WORKFLOW.md). Groomen doe je hier, bouwen doe je in
de applicatie.

## Een applicatie koppelen

Een applicatie heeft twee dingen: een `factory.json` met naam, poorten en paden,
en de factory als devDependency op een tag.

```json
{
  "naam": "assistant",
  "poorten": { "dev": 3001, "acc": 3002, "prod": 3000 },
  "envRoot": "~/AppEnvs/assistant",
  "dekkingsMinimum": 80,
  "dekkingsRatchet": "waarschuw"
}
```

`dekkingsMinimum` (0–100) is optioneel en maakt van testdekking een poort: staat
het er, dan faalt de volledige `factory verify` — en daarmee `factory release` —
als het **gecombineerde** dekkingscijfer eronder zakt. Ontbreekt de sleutel, dan
wordt dekking wel gemeten en getoond maar niet afgedwongen, zodat een app niet
meteen rood staat. Coverage draait alleen bij de volledige poort, niet in
`--snel`/`--pre-commit`.

**De dekkings-ratchet** vult die vaste bodem aan met een bewegende lat. Een vaste
`dekkingsMinimum` vóórkomt geen daling — hij bepáált de eindbestemming ervan: de
dekking zakt tot precies de drempel en blijft daar. De ratchet legt het hoogste
niveau dat de app ooit haalde vast in `dekking-basislijn.json` (in versiebeheer)
en vergelijkt elke volledige verify daarmee, over alle vier de metrics (lines,
statements, functions, branches — niet alleen regels). Zakt een metric verder dan
`dekkingsTolerantie` (default 0.5 procentpunt, tegen v8-ruis) onder de basislijn,
dan is dat een regressie; stijgt hij erboven, dan schuift de lat mee omhoog en
nooit omlaag. `dekkingsRatchet` bepaalt het gedrag: `waarschuw` (default) meldt een
daling geel maar houdt de poort groen, `blokkeer` laat verify falen net als de
bodem, `uit` legt de ratchet stil. De eerste volledige verify zonder basislijn is
een bootstrap: hij legt het huidige niveau vast zonder te oordelen. `factory
release` neemt een verhoogde basislijn mee in het release-commit; de pre-commit
hook raakt hem niet, want die slaat coverage over. Advies: begin op `waarschuw`,
en zet 'm op `blokkeer` zodra de meldingen kloppen en niet ruisen.

Het cijfer is de **merge** van de testsoorten, niet de hoogste losse soort. Elke
soort meet zijn eigen laag — unit de domeinlogica (`core/`, `flags/`, `config.ts`),
contract de `clients/`, e2e de hele app — en `verify` voegt de per-soort-maps
samen tot één rapport in `coverage/combined/` waar de drempel tegen getoetst wordt.
De per-soort-rapporten (`coverage/<soort>/`) blijven bestaan, zodat de beheer-tool
ze los kan tonen. De e2e-server draait als apart proces en wordt via
`NODE_V8_COVERAGE` gemeten; de e2e-`global-setup` zet die ruwe coverage met c8 om
naar `coverage/e2e/` (`factory/e2e-coverage`).

**De afhankelijkheden-audit** draait als laatste stap van de volledige verify:
`pnpm audit`, geteld vanaf `auditNiveau` (default `high`). `audit` bepaalt het
gedrag — `waarschuw` (default) meldt geel en houdt de poort groen, `blokkeer` laat
verify falen, `uit` slaat de stap over. Advies-eerst, net als de ratchet: een
advisory in een transitieve dev-dependency mag geen release gijzelen zolang je hem
nog niet beoordeeld hebt. De stap onderscheidt bewust "niets gevonden" van "kon
niet draaien": zonder netwerk waarschuwt hij en toetst hij niets, in plaats van
groen te kleuren of de poort te laten omvallen op een DNS-blip.

Zo staat de poort bij het **release-moment**: `factory release` draait de volledige
verify, dus er ontstaat geen tag onder de drempel, en `factory promote prod` rolt
alleen bestaande tags uit — code onder de drempel bereikt de productie dus niet.
De drempel geldt tegen het gemergede cijfer, dus zet 'm iets onder de huidige
gecombineerde dekking: hoog genoeg om regressies te vangen, met lucht voor een
legitieme dip.

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

## Auto-deploy naar acc en prod

Heeft een app een `deploy.yml` (via `factory sync`) en een self-hosted runner met
label `mini` op de mini, dan rolt elke merge naar `main` automatisch uit. De
workflow draait `factory deploy acc` (nieuwe release-tag + promote acc) en daarna
prod. Bevat de change een **nieuwe DB-migratie** (`factory heeft-migratie` kijkt
naar toegevoegde bestanden onder `migrations/` t.o.v. de vorige tag), dan rolt de
workflow prod **niet** automatisch uit — migraties rollen niet automatisch terug —
maar meldt met een warning + een run-samenvatting dat je prod handmatig moet
uitrollen met `factory promote prod`. Zonder migratie gaat prod automatisch door.

(Een `prod`-environment met verplichte reviewer zou fraaier zijn, maar
environment-protection is op private persoonlijke repos niet beschikbaar — net als de
merge-queue vereist het een Team/Enterprise-organisatie. Vandaar de handmatige
promote-stap i.p.v. een approval-klik.)

Prod draait als pm2 op `127.0.0.1`, dus de uitrol kan alleen op de mini (een
GitHub-hosted runner komt er niet bij). De runner doet een verse checkout, waarin de
untracked `*.secrets.env` ontbreken; prod-secrets komen daarom uit het repo-secret
`PROD_SECRETS_ENV` (acc heeft geen secrets nodig). De runner zet je op met
`scripts/setup-runner.sh`; verder heb je eenmalig dat secret nodig.

## Seriële integratie op de apps

`factory inleveren` integreert een branch. Op de publieke factory-repo gebruikt het de
**GitHub merge-queue**. Op de private apps kan die queue niet (org-only), dus zet je
`"integratie": "lokaal"` in `factory.json`: `inleveren` geeft de PR dan het label
`wachtrij` i.p.v. auto-merge, en `factory integreer` op de mini werkt die rij **serieel**
af — oudste PR eerst. Het toetst elke PR via de bestaande CI-poort (de `ci.yml`-checks) en
merget bij groen + mergeable; een rode poort of merge-conflict koppelt terug (label eraf +
PR-comment) zonder de rij te blokkeren. Een mini-lock houdt het single-instance; `integreer`
raakt de werkmap niet aan (alleen `gh`). Een merge triggert daarna de deploy-workflow, dus
wachtrij en auto-deploy sluiten op elkaar aan.

**Automatisch aftikken.** `factory integreer --installeer` zet een LaunchAgent op de mini
die de wachtrij elke minuut afwerkt (`--verwijder` haalt 'm weg). Omdat de repo's in
`~/Documents` staan — door macOS TCC afgeschermd voor launchd — installeert `--installeer`
de factory **globaal** en draait de LaunchAgent `factory integreer --repo <owner>/<naam>`
vanuit de home-map: zo raakt de agent `~/Documents` niet aan. `--repo` richt alle
`gh`-aanroepen expliciet, dus de drain heeft de repo-map niet nodig — je kunt `factory
integreer --repo <owner>/<naam>` ook los vanuit elke map draaien. Zonder LaunchAgent draai
je `factory integreer` gewoon met de hand in de repo.

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

### Bewuste versie-pins

De toolchain loopt bewust op de nieuwste majors — scherp, maar dicht bij de
ecosysteem-standaard. Elke pin heeft een expliciete opheffingsvoorwaarde, zodat
een latere bump een duidelijke trigger heeft in plaats van giswerk:

- **TypeScript op 6.0.x** (`typescript: 6.0.3`, peer `>=6 <7`) — typescript-eslint
  ondersteunt TS 7 nog niet. Optrekken zodra typescript-eslint TS 7 steunt.
- **ESLint 10**, **@types/node 26**, **vitest 4** — telkens de nieuwste major.
  Optrekken naar de volgende major mag zodra de bijbehorende plugins en presets
  (typescript-eslint, de vitest-configs) die major steunen.
- **Node 22** (`.nvmrc`, `engines.node >=22`) — de project-node. Los daarvan
  draaien de GitHub Action-majors op de node24-runtime van de runner; die staan
  daarom op de nieuwste major (zie de comment in `workflows/ci.yml`).
