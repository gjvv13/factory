# {{APP_NAAM}}

Applicatie uit de [software factory](../factory). De pipeline, de coding guidelines
en de backlog staan daar; hier staat alleen de code van deze applicatie.

## Werken aan deze applicatie

| Stap               | Commando                             | Waar         |
| ------------------ | ------------------------------------ | ------------ |
| Idee vastleggen    | `/idee`                              | factory-repo |
| Refinen tot slices | `/refine <issue#>`                   | factory-repo |
| Slice bouwen       | `/bouw <issue#> <slice>`             | hier         |
| Poort draaien      | `pnpm verify`                        | hier         |
| Releasen           | `pnpm release [patch\|minor\|major]` | hier         |
| Uitrollen          | `pnpm promote acc\|prod [tag]`       | hier         |

De backlog van alle applicaties is één set GitHub Issues in `gjvv13/factory`, met
het `App`-veld op `{{APP_NAAM}}` voor deze applicatie (een kolom op het board, geen
label) — zie [`WORKFLOW.md`](../factory/WORKFLOW.md).

## Omgevingen

Poorten en de plek van de acc- en prod-clones staan in `factory.json`.
`pnpm env status` laat zien wat er draait; `pnpm env start|stop|reload|logs <omgeving>`
bedient ze. Alle drie draaien onder pm2 en binden op `127.0.0.1`.

Configuratie staat in `environments/<omgeving>.env`; waarden die niet in git
horen komen in `environments/<omgeving>.secrets.env` (genegeerd door git). Die
bestanden staan in deze repo (de dev-clone), niet in de acc-/prod-clone: pm2 leest
de env dáár vandaan. Wijzig je een waarde of secret, herlaad de omgeving dan met
`pnpm env reload <omgeving>` — dat doet een verse start (`pm2 delete` + `start`),
zodat de wijziging meegaat; een gewone `restart` houdt de oude env vast. `promote`
en `reload` tonen na afloop welke sleutels geladen zijn, zodat een gemiste secret
opvalt.

## Feature flags

```bash
pnpm flag prod                # alle flags met hun stand
pnpm flag prod ping on        # aanzetten
pnpm flag prod ping off       # uitzetten
```

Flags staan per omgeving in de eigen database en worden met een korte cache
gelezen, dus omzetten werkt zonder herstart. Een commando met een `flagKey`
bestaat niet zolang de flag uit staat: het valt ook uit `help` weg.

## De applicatie

De kern is kanaalonafhankelijk: een adapter zet iets van buiten om in een
`InboundMessage` en geeft die aan `MessageService`, die de `CommandRouter` laat
beslissen. Een nieuw kanaal is dus een nieuwe adapter zonder wijziging in de logica.

```
app/src/
  app.ts              compositieroot: alles wordt hier samengeknoopt
  config.ts           omgevingsvariabelen, gevalideerd met Zod
  core/               domeinlogica: commando's, router, message-service, clock
  channels/           http, cli, fake (unit tests)
  clients/            uitgaande HTTP, vastgelegd met contract tests
  db/                 schema, migraties, testdata inlezen
  http/               Fastify-server en routes
```

Commando's nu: `help`, `ping` (achter flag `ping`), `hallo`, `versie`.

```bash
curl -s localhost:{{PORT_DEV}}/channels/http/inbound \
  -H 'content-type: application/json' \
  -d '{"from":"+31600000001","text":"ping"}'
```

## Testen

```bash
pnpm verify          # alles, in de volgorde van de poort
pnpm verify --snel   # zonder e2e, tijdens ontwikkelen
```

De volledige poort meet ook testdekking (unit + contract + e2e, samengevoegd tot
één cijfer). Staat er een `dekkingsMinimum` in `factory.json`, dan faalt `pnpm
verify` — en dus `pnpm release` — als de gecombineerde dekking eronder zakt.
`--snel` en de pre-commit hook slaan coverage over, dus lokaal ontwikkelen blijft
snel; de poort bijt bij release en in CI.

Testdata staat in `app/test/fixtures/` en wordt vóór elke test opnieuw ingelezen.
Een test mag nooit afhangen van wat een vorige test achterliet. Handmatig
verversen: `pnpm seed` (geblokkeerd op prod).

De coding guidelines zijn de `coding-guidelines`-skill in
`.claude/skills/coding-guidelines/`. Claude Code laadt die vanzelf zodra je code
schrijft of wijzigt; hij komt via `factory sync` uit de factory-repo.
