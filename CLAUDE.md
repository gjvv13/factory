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

| Commando                                          | Wat het doet                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `factory verify [--snel]`                         | Kwaliteitspoort: opmaak, lint, types, unit, contract, e2e, build               |
| `factory werkplek <issue#> [--op]`                | Eigen werkmap (git worktree) voor een slice, naast de repo; `--op` ruimt op    |
| `factory inleveren [--titel=<t>]`                 | Poort draaien, branch pushen, PR openen, in de queue zetten, werkplek opruimen |
| `factory integreer`                               | De factory-wachtrij afwerken (private apps zonder GitHub merge-queue)          |
| `factory release [patch\|minor\|major]`           | Verify (incl. dekkingspoort), versie verhogen, committen, taggen, pushen       |
| `factory promote <acc\|prod> [tag]`               | Tag uitrollen, migreren, herstarten, gezondheid controleren                    |
| `factory deploy <acc\|prod>`                      | Uitrol-orchestratie voor de runner: `acc` = release + promote acc              |
| `factory rooktest <acc\|prod>`                    | Eén read-only aanroep door de kern na een uitrol (uit `factory.json`)          |
| `factory terugrol <acc\|prod>`                    | Promote de vorige tag terug naar de omgeving (de terugweg na een uitrol)       |
| `factory env <status\|start\|stop\|reload\|logs>` | Omgevingen bedienen via pm2; `reload` herlaadt de env-bestanden vers           |
| `factory flag <omgeving> [naam] [on\|off]`        | Feature flags omzetten zonder deploy                                           |
| `factory nieuw <naam>`                            | Nieuwe applicatie uit het skeleton, met een vrij poortblok                     |
| `factory sync`                                    | Slash commands, git hook en CI-workflow in een app gelijkzetten aan deze repo  |
| `factory orkestreer <--dry\|--eenmalig>`          | Onbemande werker op de wachtrij _Klaar voor technische refinement_             |

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
| 4. Akkoord     | → kolom **Klaar voor Bouwen**        | hier             |
| 5. Bouwen      | `/bouw <issue#>`                     | in de applicatie |
| 6. Testen      | `pnpm verify`                        | in de applicatie |
| 7. Releasen    | `pnpm release [patch\|minor\|major]` | in de applicatie |
| 8. Promoveren  | `pnpm promote acc\|prod [tag]`       | in de applicatie |

Stap 2 legt vast **wat** het moet doen (dat weet alleen jij), stap 3 **hoe** (dat
volgt uit de code). Die knip maakt stap 3 uitbesteedbaar aan een onbemande werker
zonder dat een idee ooit ongezien code wordt; de kolom op het board is de riem. Voor
kleine `type:task`- en `type:bug`-items mag stap 2 overgeslagen worden: `/refine` op
een item uit **Idee** doet beide helften in één keer.

`/status` geeft het overzicht over de backlog en alle applicaties.

De **backlog is één set GitHub Issues** in `gjvv13/factory`. Het **board** is de bron
van waarheid voor waar een item staat: het `App`-veld per applicatie en het
`Status`-veld (Idee → Functioneel uitwerken → Klaar voor technische refinement →
Technisch refinen → Klaar voor Bouwen → Bouwen → Uitrollen → Done) per fase; de
"klaar voor"-kolommen zijn wachtrijen waar niemand aan zet is. Er zijn geen `status:`-labels — zie
[`WORKFLOW.md`](WORKFLOW.md). Groomen doe je hier, bouwen doe je in de applicatie.

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

Een verbetering aan de pipeline bereikt een applicatie **automatisch** (#132): een
merge naar factory-`main` triggert `release.yml`, die de volgende versie afleidt van de
**nieuwste git-tag** (niet van `package.json` op main, dat kan achterlopen), de tag
meteen zet (buiten de ruleset om — dit is wat de apps oppikken) en main's `package.json`
via een **auto-merge-PR** bijwerkt. Die PR wordt met een PAT (`RELEASE_PAT`) aangemaakt,
niet met `github.token`: een GITHUB_TOKEN-PR triggert `ci.yml` niet, dus `verify`
verschijnt nooit en de auto-merge zou blijven hangen (#163). Zonder de PAT slaat de
PR-stap over — de tag komt hoe dan ook vrij, alleen loopt main's `package.json` dan
achter. Elke app draait een `bump-factory.yml` die de nieuwste tag oppikt,
`factory sync` doet (CLI én workflows, skills, hook komen mee) en via de gewone pijplijn
naar prod rolt. Slash commands en de git hook moeten fysiek in de app-repo staan;
`factory sync` doet dat, en de auto-bump draait 'm voor je.

**Eenmalige bootstrap.** Het auto-bump-bestand moet de eerste keer met de hand in een
app landen: bump de factory-dep, `pnpm install`, `factory sync`, en lever in. Vanaf dan
gaat het vanzelf. Wil je een app tijdelijk bevriezen op een factory-versie, verwijder
dan zijn `bump-factory.yml` (of zet 'm in `syncNegeer`).

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

De mini heeft af en toe een **transiente DNS-blip** naar GitHub-hosts (#99). De
netwerkstappen zijn daarom verhard: `factory release` herhaalt de `git push` bij een
DNS-fout (in de CLI), en `deploy.yml` draait `pnpm install` in een bounded retry (3×
met backoff). Eén ding valt buiten deze retry: het **downloaden van een action**
(bijv. `actions/checkout`, maar ook `setup-node` en `pnpm/action-setup`) gebeurt vóór
de stap draait en is niet in de workflow te omhullen. Daarvoor is er een apart vangnet
(#122): `deploy-rerun.yml` draait ná een gefaalde deploy-run, herkent de
action-download-faalsignatuur in de log en start de gefaalde jobs **eenmalig** opnieuw
(alleen bij `run_attempt == 1`, zodat een echte bouwfout na één rerun rood blijft). Een
transiente hik lost zichzelf zo op i.p.v. prod stil te laten achterlopen; handmatig
`gh run rerun --failed` blijft de terugval.

**Een gefaalde deploy is niet meer stil (#112).** `/health` meldt "ok" ook als een
uitrol niet aankwam en de oude versie nog draait; daarom toetst `promote` na de swap
of de gemelde `version` de beoogde tag is, en faalt het luid (met proces-rollback) bij
een afwijking — een deploy is pas groen als de juiste versie echt draait. En omdat een
gefaalde `deploy.yml`-job anders alleen een rood vinkje in de Actions-tab achterlaat,
meldt een `if: failure()`-stap dat aan de assistent (die naar Matrix relayt). De melding
draagt app, run-id, de **draaiende** versie (uit `/health` op de omgevingspoort) en de
**beoogde** tag (uit `package.json`) — precies het gat waar "ok" op de oude versie stil
bleef. Die stap draait ook als een eerdere stap omviel (bijv. de action-download); dan
blijven versie/tag "onbekend" i.p.v. dat de meldstap zelf omvalt. Hij is een no-op met
waarschuwing zolang `DEPLOY_NOTIFY_URL` niet is gezet.

**Rooktest en terugweg (#121).** `/health` "ok" bewijst niet dat de kern werkt. Zet
daarom een rooktest in `factory.json` — één **read-only** aanroep die `factory rooktest`
na de uitrol tegen de omgeving draait (acc én prod, acc eerst), bijvoorbeeld:

```json
"rooktest": { "pad": "/channels/http/inbound", "body": "{\"from\":\"rooktest\",\"text\":\"ping\"}", "bevat": "pong" }
```

Faalt de rooktest, dan wordt de deploy-job rood (en dat meldt zich via de
gefaalde-deploy-melding hierboven); er wordt **niet** automatisch teruggerold — dat kan
verrassender zijn dan het probleem. De terugweg staat klaar als los commando:
`factory terugrol <acc|prod>` promoot de vorige tag terug (seconden werk t.o.v. vooruit
fixen). Zonder een `rooktest`-blok is de stap een no-op, zodat de workflow 'm altijd mag
aanroepen. De read-only garantie ligt bij jou: kies een leesactie, geen bestelling en
geen regel in iemands lijst.

### Het bord bijwerken vanuit een uitrol

`factory inleveren` en `factory promote prod` verplaatsen het backlog-item zelf op het
board (#128): naar **Uitrollen** bij het inleveren, naar **Done** zodra prod de tag
draait. Welke items dat zijn komt uit de branchnaam (`slice/<issue>-<n>`) en uit de
merge-commits in het tagbereik — er wordt niets apart bijgehouden.

Lokaal werkt dat met je eigen `gh`-auth. **In een workflow niet**, en dat is geen bug
van ons: het ingebouwde `GITHUB_TOKEN` is gebonden aan het repo waarin de workflow
draait, terwijl het board onder een persoonlijk account hangt en de backlog in een
ánder repo staat. Zet daarom eenmalig een PAT als repo-secret `PROJECT_TOKEN`, met
scope `project` plus lees/schrijf op de backlog-repo. Ontbreekt het secret, dan
waarschuwt de stap en blijft de deploy groen — het bord loopt dan achter, de uitrol
niet.

Een bordfout houdt nooit een uitrol tegen: de pijplijn levert software af, de
administratie is bijvangst.

## De onbemande werker

`factory orkestreer` is de supervisor uit [#104](https://github.com/gjvv13/factory/issues/104):
hij pakt het oudste item uit de kolom **Klaar voor technische refinement** en laat er
één headless `claude -p` op los die de technische helft van de refinement schrijft.

```bash
factory orkestreer --dry        # toont de wachtrij en wat hij zou doen; schrijft niets
factory orkestreer --eenmalig   # werkt één item af
```

Een kaal `factory orkestreer` doet niets: er is nog geen automatiek, en een commando
dat ongevraagd een werker start is precies de verrassing die je bij onbemand werk niet
wilt.

**Waar de werker draait.** In een spiegel onder `~/OrkestratorWerk/<app>`, buiten
`~/Documents`. Dat is geen beleefdheid: macOS schermt `~/Documents` met TCC af voor
achtergrondprocessen (dezelfde reden waarom `factory integreer` die map mijdt), en er
lopen parallelle sessies in de werkkopieën. De spiegel wordt vóór elke run hard
teruggezet op `origin/main` en is wegwerpbaar. De factory-spiegel gaat als extra
leesmap mee, zodat de werker de templates, `WORKFLOW.md` en de coding-guidelines kan
lezen.

**De werker schrijft niets.** Hij leest code en het issue en levert de uitwerking terug
als data (`--json-schema`); de CLI zet die op GitHub. Daarmee heeft hij geen enkel
schrijfrecht nodig — en dat is ook zo afgedwongen, met een **toestemmingslijst** en niet
alleen een verbodslijst. Gemeten op 2026-08-19: met alléén `Write` en `Edit` verboden
schrijft het model gewoon via `Bash(echo … > bestand)`.

**De uitkomst komt uit de JSON, nooit uit de exitcode.** Ook gemeten: een run die niets
deed omdat elk recht geweigerd werd eindigde met `exit 0`, `is_error: false` én
`subtype: "success"`; een run die zijn budget overschreed juist mét `exit 1`. Alleen het
verdict telt. Geen verdict is een mislukking, geen "waarschijnlijk gelukt".

**De poort blijft bij jou.** De orkestrator zet een item op **Technisch refinen** en
laat het daar staan. Naar **Klaar voor Bouwen** verplaatsen doet hij nooit — voor een
refinement bestaat geen `verify` die hem kan afkeuren, dus de enige poort is je akkoord.
Mislukt een run of heeft de werker een vraag, dan krijgt het issue het label `escalatie`
plus een comment, en wordt het niet opnieuw opgepakt.

**Het board wordt één keer per run gelezen.** GitHub geeft 5000 GraphQL-punten per uur
voor het hele account, gedeeld met elke sessie. Een `gh project item-list` kost er 102,
de gerichte query in `board.ts` kost er 2. De supervisor leest het board dus één keer en
geeft elke werker zijn app, kolom en issuenummer mee; een werker zoekt niets op.

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
