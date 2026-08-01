---
id: beheer-console
titel: Beheer-applicatie (ops-console)
status: refined
aangemaakt: 2026-07-30
gerefined: 2026-07-31
---

# Beheer-applicatie (ops-console)

## Samenvatting

Een nieuwe, kleine applicatie `beheer` die de operationele bediening van de
andere applicaties op één plek bundelt. Versie één toont in één webpagina de
health van alle applicaties en hun omgevingen (slice 1) en laat je hun feature
flags omzetten (slice 2). Het console draait loopback-only zonder authenticatie,
kent de applicaties uit een expliciet register, en praat met hun bestaande
admin-endpoints (`/health`, `/admin/flags`) — het bouwt niets van dat gedrag na.

## Functionele architectuur

### Gedrag

Je opent het console in de browser op de Mac en ziet in één blik hoe alles ervoor
staat:

```
Beheer — health

  applicatie   omgeving   status         versie   kanaal     uptime
  assistant    dev        ● ok           0.1.5    http       3u
  assistant    acc        ● ok           0.1.2    http       3u
  assistant    prod       ● ok           0.1.5    whatsapp   12m   (verbonden)
  beheer       prod       ● ok           0.1.0    http       12m
  voorbeeld    prod       ○ onbereikbaar  —        —          —
```

In slice 2 komt daar het omzetten van flags bij:

```
Beheer — flags · assistant · prod

  ping              [aan]   ●———
  whatsapp-channel  [uit]   ———○   → klik om aan te zetten
```

Een omgeving die niet reageert (gestopt, verkeerde poort) verschijnt als
"onbereikbaar" met de rest gewoon zichtbaar; het console valt niet om door één
dode omgeving.

### Regels en randgevallen

- **Read-only health, live gepolld:** elke keer dat de overzichtspagina laadt,
  vraagt het console de `/health` van elke omgeving op. Niets wordt bewaard.
- **Onbereikbare omgeving:** een time-out of foutstatus levert een rij met status
  "onbereikbaar" op, niet een lege pagina of een crash. De http-client heeft al
  een time-out; die gebruiken we.
- **Register is de bron van waarheid over wélke apps er zijn:** staat een app niet
  in het register, dan toont het console hem niet. Het register bevat per app de
  poorten per omgeving (overgenomen uit hun `factory.json`).
- **Flags omzetten (slice 2)** gaat via de `PUT /admin/flags/:key` van de dóél-app;
  het console bewaart geen flags zelf en beslist niets — het is een bediening op
  afstand. Deze muterende functie zit achter een flag (`beheer-flags`).
- **Loopback-only:** het console bindt op `127.0.0.1`, net als de admin-routes van
  de apps. Geen authenticatie, want het is alleen vanaf de Mac bereikbaar.

### Wat het expliciet níet doet

- **Geen authenticatie en geen toegang van buiten de Mac.** Bereikbaarheid vanaf
  je telefoon (met auth, TLS) is bewust uitgesteld naar een apart idee.
- **Geen onomkeerbare acties.** Geen herstarten, promoten of seeden vanaf de
  pagina; dat blijft bij de `factory`-CLI. Het console leest en zet hooguit een
  flag om.
- **Geen log-niveau en geen test-coverage in deze refinement.** Die twee blijven
  aparte ideeën (`log-niveau`, `test-coverage`), omdat ze eerst nieuwe endpoints
  in de dóél-apps vragen: het log-niveau is nu een opstart-variabele (geen
  runtime-endpoint), en coverage wordt nergens verzameld. Zonder die basis kan het
  console ze niet tonen of bedienen.
- **Geen eigen domeinlogica.** Het console knoopt geen chat, commando's of kanalen
  aan; die delen van het skeleton horen hier niet en gaan eruit.

## Technische architectuur

De app ontstaat uit `factory nieuw beheer` (vrij poortblok: prod 3010, dev 3011,
acc 3012) en wordt getrimd tot de fundament-lagen die een console nodig heeft. De
lagen volgen `CODING_GUIDELINES.md`.

### Onderdelen

| Laag    | Bestand                            | Wat er verandert                                                                                                                                                                                             |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| clients | `app/src/clients/admin-client.ts`  | Nieuw. Uitgaande calls naar de admin-API van een app-omgeving: `readHealth` (slice 1), `listFlags`/`setFlag` (slice 2). Leunt op `http-client.ts`. Krijgt Pact-contracten.                                   |
| core    | `app/src/core/registry.ts`         | Nieuw. Bouwt uit het register (config) de lijst doelen: per app × omgeving een `baseUrl`.                                                                                                                    |
| core    | `app/src/core/overview-service.ts` | Nieuw. Aggregeert: vraagt per doel de health op, vangt onbereikbaarheid af, levert het overzicht.                                                                                                            |
| core    | `app/src/core/flag-beheer.ts`      | Slice 2. Leest en zet flags van een dóél-app via de admin-client.                                                                                                                                            |
| —       | `app/src/config.ts`                | Leest en valideert het register (pad naar `apps.json`), met Zod.                                                                                                                                             |
| —       | `app/src/app.ts`                   | Knoopt registry, admin-client en de services samen (compositieroot).                                                                                                                                         |
| http    | `app/src/http/routes/overview.ts`  | Nieuw. `GET /` levert de consolepagina; `GET /api/overview` de geaggregeerde health-JSON.                                                                                                                    |
| http    | `app/src/http/routes/flags.ts`     | Slice 2. `GET`/`PUT /api/apps/:app/:omgeving/flags[/:key]` proxyt naar de dóél-app, achter `beheer-flags`.                                                                                                   |
| http    | `app/src/http/routes/health.ts`    | Behouden: de eigen health van het console (uit het skeleton).                                                                                                                                                |
| —       | `app/src/` (opschonen)             | Weg: `channels/` (op http na), `core/commands.ts`, `core/command-router.ts`, `core/contacts.ts`, `core/message*.ts`, `routes/inbound.ts` en hun tests/fixtures — chat-onderdelen die een console niet heeft. |

De consolepagina is één zelfstandige HTML-pagina (inline CSS/JS, geen externe
bronnen — past bij loopback-only), die `GET /api/overview` ophaalt en de tabel
rendert. De `http`-laag valideert en roept `core` aan; de opmaak zit in de pagina.

### Datamodel

**Geen migratie in slice 1.** De health wordt live opgehaald en nergens bewaard.
Het skeleton levert al een `feature_flags`-tabel; slice 2 hergebruikt die voor de
eigen flag `beheer-flags` (alleen een fixture/seed-regel erbij, geen schemawijziging).

Het **register** is geen database maar een config-bestand `apps.json` in de
repo (poorten zijn geen geheim), Zod-gevalideerd:

```json
[
  {
    "naam": "assistant",
    "host": "127.0.0.1",
    "poorten": { "dev": 3001, "acc": 3002, "prod": 3000 }
  },
  { "naam": "beheer", "host": "127.0.0.1", "poorten": { "dev": 3011, "acc": 3012, "prod": 3010 } }
]
```

Eenmalig overgenomen uit de `factory.json`'s van de apps. De beheer-app zelf mag
erin staan, zodat het console ook z'n eigen health toont.

### Externe koppelingen

Het console roept de admin-API van elke app-omgeving aan over loopback HTTP. Dat
is een echte uitgaande koppeling, dus **met Pact-contract** (zoals de guidelines
eisen). De `provider` is een generieke factory-app-admin-API; de `consumer` is
`beheer`:

- Slice 1: `GET /health` levert `{ status, environment, version, channel, uptimeSeconds, connection? }`.
- Slice 2: `GET /admin/flags` levert `{ flags: [{ key, enabled, description, updatedAt }] }`, en `PUT /admin/flags/:key` met `{ enabled }` levert de bijgewerkte flag.

Deze contracten vervangen het voorbeeld-Pact uit het skeleton: nu pinnen ze het
échte contract met de andere applicaties. Verandert een app z'n admin-API, dan
vangt het contract dat.

### Feature flag

- Slice 1 (read-only health): **geen flag** — het leest alleen en is onschadelijk.
- Slice 2 (flags van andere apps omzetten): achter **`beheer-flags`**, standaard
  uit in productie tot je de bediening op afstand vertrouwt.

## Slices

### Slice 1 — Beheer-app en health-overzicht

- **Doel:** er is een draaiende `beheer`-app die in één pagina de health van alle
  geregistreerde applicaties en omgevingen toont.
- **Acceptatiecriteria:**
  - [x] `factory nieuw beheer` is uitgevoerd en de app is getrimd tot de
        fundament-lagen (geen chat-onderdelen meer); `pnpm verify` is groen.
  - [x] Het register (`apps.json`) wordt met Zod gevalideerd; een ongeldig register
        laat de app hard falen bij het opstarten.
  - [x] `GET /api/overview` geeft per app × omgeving de health terug, met
        onbereikbare omgevingen als status "onbereikbaar".
  - [x] `GET /` toont die informatie als leesbare tabel in de browser.
- **Tests:** unit: `registry` (register → doelen) en `overview-service`
  (aggregeren + onbereikbaarheid afvangen) met een fake admin-client · contract:
  Pact voor `GET /health` tegen de factory-app-admin-API · e2e: start het console
  met een register dat naar z'n eigen `/health` wijst, en controleer dat
  `/api/overview` één gezonde rij teruggeeft
- **Testdata:** een test-`apps.json` dat naar de eigen poort wijst; de
  chat-fixtures (`contacts.json`) vervallen met het opschonen.
- **Flag:** geen.

### Slice 2 — Flags beheren vanaf het console

- **Doel:** je kunt de feature flags van elke geregistreerde app-omgeving zien en
  omzetten vanuit het console.
- **Acceptatiecriteria:**
  - [x] `GET /api/apps/:app/:omgeving/flags` toont de flags van die omgeving.
  - [x] `PUT /api/apps/:app/:omgeving/flags/:key` zet een flag om via de admin-API
        van de dóél-app; de wijziging is daar meteen actief.
  - [x] De consolepagina toont per omgeving de flags met een schakelaar.
  - [x] Alles achter `beheer-flags`; staat die uit, dan bestaat de functie niet.
- **Tests:** unit: `flag-beheer` (lezen/zetten) met een fake admin-client ·
  contract: Pact voor `GET /admin/flags` en `PUT /admin/flags/:key` · e2e: register
  naar de eigen `/admin/flags` (uit het skeleton), zet een eigen flag om via het
  console en lees de nieuwe stand terug
- **Testdata:** `beheer-flags` toegevoegd aan de feature-flag-fixture (uit).
- **Flag:** `beheer-flags` (uit in productie tot vertrouwd).

## Risico's

- **Skeleton is chat-gevormd:** het opschonen tot een console moet zorgvuldig,
  zodat `verify` (opmaak, lint, types, tests, build) groen blijft. Aandachtspunt
  in slice 1; klein te houden door in één keer de ongebruikte lagen én hun tests
  te verwijderen.
- **Register kan verouderen:** de poorten in `apps.json` dupliceren de
  `factory.json`'s en kunnen gaan afwijken. Voor nu bewust: eenmalig overnemen en
  documenteren; automatisch afleiden kan een later idee zijn.
- **Onbereikbare omgevingen:** het overzicht polt localhost-poorten; een gestopte
  omgeving mag het overzicht niet ophouden of laten crashen. Afgevangen met de
  time-out van de http-client en een expliciete "onbereikbaar"-status.
- **Alleen lokaal bruikbaar:** loopback-only betekent dat het console alleen op de
  Mac werkt. Bewust; telefoontoegang is een apart idee.
- **Contractafhankelijkheid:** verandert een app z'n admin-API, dan breekt het
  contract — dat is de bedoeling, maar het betekent dat een wijziging aan de
  admin-API van een app ook het beheer-contract raakt.

## Besluiten

- **Eigen applicatie via `factory nieuw beheer`** (poorten 3010–3012), getrimd tot
  de fundament-lagen. Reden: flags/log/health zijn ops, geen domein; ze horen niet
  in een domein-app, en health is app-overstijgend.
- **Loopback-only, geen auth in v1**, consistent met de admin-routes van de apps.
  Telefoontoegang + authenticatie is een aparte, latere stap.
- **Expliciet register in config** (`apps.json`, Zod-gevalideerd), eenmalig
  overgenomen uit de `factory.json`'s. Boven werkruimte-scannen gekozen omdat de
  draaiende prod-clone niet van de dev-werkruimte mag afhangen.
- **Twee slices: health (read-only), dan flags.** Beide leunen op wat de apps al
  exposen. `log-niveau` en `test-coverage` blijven aparte ideeën omdat ze eerst
  nieuwe endpoints in de dóél-apps vragen.
- **Read-only health zonder flag; muterend flag-beheer achter `beheer-flags`.**
- **Geen migratie:** health is live gepolld; de bestaande `feature_flags`-tabel
  volstaat voor de eigen flag.
- **admin-client krijgt Pact-contracten** (provider = factory-app-admin-API), zoals
  elke uitgaande koppeling; ze vervangen het voorbeeld-Pact uit het skeleton.
