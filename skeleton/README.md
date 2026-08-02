# {{APP_NAAM}}

De korte instap voor een mens. De kern is kanaalonafhankelijk: een adapter zet
iets van buiten (HTTP, later een ander kanaal) om in een `InboundMessage` en geeft
die aan de `MessageService`, die de `CommandRouter` laat beslissen. Een nieuw
kanaal is dus een nieuwe adapter zonder de logica te raken.

Applicatie uit de [software factory](../factory). De pipeline, de coding
guidelines en de backlog staan daar; hier staat alleen de code van deze
applicatie. Meer detail voor Claude Code: [`CLAUDE.md`](CLAUDE.md).

## Snel starten

```bash
pnpm install
pnpm dev                 # start op poort {{PORT_DEV}} (dev)
```

```bash
curl -s localhost:{{PORT_DEV}}/channels/http/inbound \
  -H 'content-type: application/json' \
  -d '{"from":"+31600000001","text":"ping"}'
```

Commando's nu: `help`, `ping` (achter flag `ping`), `hallo`, `versie`.

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

## Omgevingen en flags

Drie omgevingen (dev {{PORT_DEV}}, acc {{PORT_ACC}}, prod {{PORT_PROD}}) draaien
onder pm2 op `127.0.0.1`; poorten en paden staan in `factory.json`. `pnpm env
status` toont wat er draait, `pnpm flag prod` de feature flags. Flags worden met
een korte cache gelezen, dus omzetten werkt zonder herstart.

Configuratie staat in `environments/<omgeving>.env`; waarden die niet in git horen
komen in `environments/<omgeving>.secrets.env` (genegeerd door git).

## Structuur

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

## Testen

```bash
pnpm verify          # alles, in de volgorde van de poort
pnpm verify --snel   # zonder e2e, tijdens ontwikkelen
```

Testdata staat in `app/test/fixtures/` en wordt vóór elke test opnieuw ingelezen;
een test mag nooit afhangen van wat een vorige achterliet. De coding guidelines
staan in de factory-repo. Meer detail over deze repo: [`CLAUDE.md`](CLAUDE.md).
