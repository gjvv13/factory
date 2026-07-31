---
id: koppeling-behouden
titel: Robuuste WhatsApp-koppeling via de Cloud API
status: refined
aangemaakt: 2026-07-30
gerefined: 2026-07-31
---

# Robuuste WhatsApp-koppeling via de Cloud API

## Samenvatting

De assistent stapt van het gekoppelde-apparaat-model (`whatsapp-web.js`) over naar
de officiële **WhatsApp Cloud API** van Meta. Geen QR die verloopt, geen toestel
dat online moet blijven: de registratie ligt bij Meta. Inkomende berichten komen
binnen via een publieke webhook, uitgaande berichten gaan via een simpele
HTTPS-call — precies de vorm waar de kanaal-adapter op is voorbereid. Voor jou als
gebruiker verandert er niets aan de commando's; de robuustheid zit onder de motorkap.

## Aanleiding

Het gekoppelde-apparaat-model is fundamenteel fragiel: WhatsApp logt het
gekoppelde apparaat uit als het eSIM-toestel te lang offline is, en dan is een
mens met een telefoon nodig om opnieuw te scannen. De beheer-console maakte dit
meteen zichtbaar — prod stond op `disconnected`. Melden-en-opnieuw-scannen is
dweilen met de kraan open zolang niemand naar het eSIM-toestel kijkt. De Cloud API
haalt de oorzaak weg in plaats van het symptoom te verzachten.

## Functionele architectuur

### Gedrag

Voor de gebruiker blijft het gesprek identiek — zelfde nummer, zelfde commando's:

```
ik:      ping
factory: pong
```

Het verschil is onzichtbaar: de koppeling kan niet meer verlopen, er is nooit meer
een QR te scannen, en er valt geen browser-sessie meer om. De "verbonden-maar-stil"
modus blijft: staat de flag uit, dan ontvangt en logt de assistent wel maar
antwoordt hij niet.

Eenmalig, bij het inrichten (slice 3), is er wél handwerk: het nummer bij de Cloud
API registreren en de publieke webhook opzetten. Dat is een ops-stap, geen
terugkerende last.

### Regels en randgevallen

- **Webhook-verificatie (GET):** Meta controleert de webhook met een
  `hub.challenge`; die beantwoorden we alleen als het `hub.verify_token` klopt.
- **Handtekening (POST):** elk inkomend bericht draagt een
  `X-Hub-Signature-256` (HMAC-SHA256 met het app-secret). Klopt die niet, dan
  `403` en negeren — zo weten we dat het écht van Meta komt.
- **Niet-bericht-events:** Meta stuurt ook status-updates (afgeleverd/gelezen).
  Die beantwoorden we met `200` en negeren we verder.
- **Onbekende afzender:** dezelfde allowlist als nu (`authorizations`); niet
  gemachtigd = volledig negeren, geen antwoord.
- **Flag uit:** ontvangen en loggen, niet antwoorden — net als het huidige kanaal.
- **Uitgaand mislukt:** een verlopen token of rate-limit levert een fout op bij het
  sturen; die loggen we. De webhook antwoordt sowieso snel `200` (anders herprobeert
  Meta), het sturen van het antwoord gebeurt daarna.
- **24-uursvenster:** vrije antwoorden mogen binnen 24 uur na jouw bericht. Omdat
  jij het gesprek begint (`ping`), val je altijd binnen dat venster — geen templates
  nodig voor gewone vraag-en-antwoord.

### Wat het expliciet níet doet

- **Geen proactieve berichten buiten het 24-uursvenster.** Dat vraagt door Meta
  goedgekeurde "utility"-templates; een apart idee als het ooit nodig is. Met de
  Cloud API is het "koppeling verlopen"-alarm overbodig geworden.
- **Geen groepen, geen media.** Blijven aparte ideeën (`whatsapp-groepen`,
  `rijke-berichten`); dit gaat puur om het transport onder tekstberichten.
- **Geen wijziging aan de commando's, de allowlist of het datamodel.** Alleen de
  weg waarlangs een bericht binnenkomt en het antwoord teruggaat verandert.
- **Geen automatische token-/nummer-gezondheidscheck** in deze refinement (zie
  Risico's); kan later een kleine toevoeging aan `/health` zijn.

## Technische architectuur

De kanaal-adapter is bewust op deze overstap ontworpen: `core/` (commando's,
router, `authorizations`, `messageService`) en het datamodel veranderen niet.
Alleen de buitenste laag — hoe een bericht binnenkomt en uitgaat — wordt vervangen.

### Onderdelen

| Laag     | Bestand                                                          | Wat er verandert                                                                                                                                                     |
| -------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| clients  | `app/src/clients/whatsapp-cloud-client.ts`                       | Nieuw. Stuurt een tekstbericht via de Graph API (`POST /{phoneNumberId}/messages`) met bearer-token. Krijgt een Pact-contract.                                       |
| clients  | `app/src/clients/http-client.ts`                                 | Uitgebreid met `postJson` (nu alleen `getJson`), zodat uitgaande POST-calls één plek voor time-out en foutafhandeling houden.                                        |
| core     | `app/src/core/whatsapp-inbound.ts`                               | Nieuw. De orkestratie authz → flag → router → antwoord sturen, met een `send`-poort. Getrokken uit de huidige adapter zodat de webhook-route dun blijft en testbaar. |
| http     | `app/src/http/routes/whatsapp-webhook.ts`                        | Nieuw. `GET` voor de verificatie (`hub.challenge`), `POST` voor inkomend (handtekening + Zod → `whatsapp-inbound` met de cloud-client als `send`).                   |
| http     | `app/src/http/routes/health.ts`                                  | Meldt `channel: whatsapp-cloud`; laat het `connection`-veld weg (er is geen blijvende verbinding die kan wegvallen).                                                 |
| —        | `app/src/config.ts`                                              | Voegt `CHANNEL=whatsapp-cloud` toe plus de Cloud-instellingen (phone-number-id, token, app-secret, verify-token, api-base, api-versie).                              |
| —        | `app/src/app.ts` / `main.ts`                                     | Knoopt de cloud-client en `whatsapp-inbound` samen en registreert de webhook-route wanneer `CHANNEL=whatsapp-cloud`.                                                 |
| channels | `app/src/channels/whatsapp-web-client.ts`, `whatsapp-channel.ts` | Slice 3: het gekoppelde-apparaat-pad (herverbinden, heartbeat, QR, puppeteer) verdwijnt zodra de Cloud API in prod bewezen is.                                       |

De ontvangst is — net als het bestaande `inbound`-kanaal — gewoon een HTTP-route,
geen blijvende `ChannelAdapter`. Daarom hoeft de adapter-abstractie hier niet
uitgebreid te worden: een route in, een client uit.

### Datamodel

**Geen migratie.** De Cloud API voegt geen opslag toe; het verkeer wordt gelogd via
de bestaande `messageService` (`message_log`), net als nu.

### Externe koppelingen

- **Uitgaand — Graph API** (`provider: whatsapp-cloud-api`, `consumer: assistant`):
  `POST /{phoneNumberId}/messages` met `Authorization: Bearer <token>` en body
  `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`, antwoord
  `{ messages: [{ id }] }`. **Met Pact-contract** (slice 1), zoals elke uitgaande
  koppeling.
- **Inkomend — webhook van Meta:** dit is binnenkomend verkeer, geen uitgaande
  client, dus geen Pact. Het contract wordt vastgepind met Zod-validatie op de
  payload plus unittests met een echte voorbeeld-payload (bericht én status-event).

### Feature flag

Hergebruik van **`whatsapp-channel`**: de flag bepaalt of de assistent ántwoordt
(verbonden-maar-stil). De webhook zelf ontvangt en logt altijd. Standaard uit in
productie tot de round-trip op het echte nummer bevestigd is.

## Slices

### Slice 1 — Uitgaand: WhatsApp Cloud-client met contract

- **Doel:** de assistent kan een tekstbericht via de Cloud API versturen, met een
  vastgelegd contract — een geteste bouwsteen, nog niet in een live pad.
- **Acceptatiecriteria:**
  - [ ] `http-client` heeft een `postJson` met dezelfde time-out- en foutafhandeling als `getJson`.
  - [ ] `whatsapp-cloud-client.sendText(to, text)` doet de juiste Graph-call (URL, bearer, body).
  - [ ] Een Pact-contract legt `POST /{phoneNumberId}/messages` vast, inclusief het `401`-gedrag bij een ongeldig token.
- **Tests:** unit: `postJson` en het opbouwen van de Cloud-request · contract: Pact tegen `whatsapp-cloud-api` · e2e: n.v.t. (geen gebruikersgedrag in deze slice)
- **Testdata:** geen nieuwe fixtures.
- **Flag:** geen.

### Slice 2 — Inkomend: webhook en volledige round-trip (dev/acc)

- **Doel:** een bericht dat via de Cloud-webhook binnenkomt wordt gemachtigd,
  gerouteerd en beantwoord — end-to-end werkend in dev/acc, achter de flag.
- **Acceptatiecriteria:**
  - [ ] `GET /channels/whatsapp/webhook` beantwoordt de verificatie alleen bij een kloppend `verify_token`.
  - [ ] `POST` weigert een payload met een ongeldige `X-Hub-Signature-256` (`403`).
  - [ ] Een geldig `text`-bericht van een gemachtigd nummer levert `pong` op via de cloud-client; met de flag uit wordt het gelogd maar niet beantwoord.
  - [ ] Status-events (afgeleverd/gelezen) worden met `200` genegeerd.
- **Tests:** unit: `whatsapp-inbound` (authz/flag/route/antwoord met een fake `send`), handtekeningcontrole, payload-Zod (bericht + status-event) · contract: hergebruikt slice 1 · e2e: start de app met `CHANNEL=whatsapp-cloud`, POST een ondertekende voorbeeld-payload, en controleer dat de cloud-client (naar een lokale stub) wordt aangeroepen
- **Testdata:** een voorbeeld-webhook-payload (bericht en status-event) in `app/test/fixtures/`.
- **Flag:** `whatsapp-channel` (hergebruik).

### Slice 3 — Productie-overstap en het oude pad opruimen

- **Doel:** prod draait op de Cloud API; het gekoppelde-apparaat-pad is weg.
- **Acceptatiecriteria:**
  - [ ] Het assistent-nummer is bij de Cloud API geregistreerd en de publieke webhook (Cloudflare Tunnel) staat; secrets in `prod.secrets.env`.
  - [ ] Prod draait met `CHANNEL=whatsapp-cloud`; een echt bericht op het nummer krijgt `pong` met de flag aan.
  - [ ] `whatsapp-web-client.ts` en de herverbind-/heartbeat-/QR-machinerie zijn verwijderd, net als de deps `whatsapp-web.js`, `qrcode-terminal` en de puppeteer-config; `pnpm verify` is groen.
  - [ ] De beheer-console toont het kanaal `whatsapp-cloud` zonder verbindingsstatus.
- **Tests:** unit: aangepast/verwijderd met het oude kanaal · contract: ongewijzigd · e2e: bestaande WhatsApp-e2e omgezet naar de webhook-vorm
- **Testdata:** de linked-device-fixtures/afhankelijkheden vervallen.
- **Flag:** `whatsapp-channel` (aan zetten zodra de round-trip op prod klopt).

## Risico's

- **Publieke webhook:** Meta moet een publieke HTTPS-URL kunnen bereiken; de
  assistent draait nu loopback op de Mac. Advies: **Cloudflare Tunnel** (gratis, geen
  open poorten). Valt de tunnel weg, dan stopt de ontvangst tijdelijk — maar niets
  verloopt, en Meta herprobeert webhooks een tijd lang; het herstelt zodra de tunnel
  terug is.
- **Rauwe body voor de handtekening:** de HMAC gaat over de exacte bytes, maar
  Fastify parseert JSON. We moeten de rauwe body vasthouden (een
  `content-type-parser` of `rawBody`), anders klopt de handtekening nooit.
  Technisch valkuiltje om vroeg te regelen.
- **Token-beheer:** een 60-daagse token verloopt; een permanent System-User-token
  niet. Advies: een System-User-token. Verloopt het toch, dan mislukt uitgaand en
  zie je dat in de logs; een token-check in `/health` kan later waarschuwen.
- **Nummer-migratie is bijna eenrichting:** het nummer verlaat de gewone WhatsApp-app
  zodra het bij de Cloud API staat. Bewust: het is een toegewijd nummer, je
  persoonlijke nummer blijft ongemoeid. Was het eerder in de app geregistreerd, dan
  moet dat eerst worden losgemaakt.
- **Kosten:** verwaarloosbaar voor persoonlijk volume — service-gesprekken (door jou
  gestart, binnen 24 uur) zijn gratis. Alleen proactieve templates buiten het venster
  kosten iets, en die doen we hier niet.

## Besluiten

- **Cloud API boven het gekoppelde-apparaat-model.** De oorzaak wegnemen (geen
  toestel, geen QR) in plaats van het symptoom melden. De adapter-opzet was hier al
  op voorbereid.
- **`core/` en het datamodel blijven ongemoeid.** Alleen het transport verandert:
  webhook in, Graph-client uit. `authorizations`, `flags` en `messageService` worden
  hergebruikt.
- **Ondertekende, Zod-gevalideerde webhook.** Handtekeningcontrole (app-secret) tegen
  vervalste calls; Zod pint de payload-vorm.
- **Cloudflare Tunnel** voor de publieke webhook, boven open poorten of een VPS.
- **Het eSIM-nummer wordt toegewijd aan de Cloud API.**
- **Drie slices: uitgaand (client+contract), inkomend (webhook+round-trip),
  productie-overstap+opruimen.** Zo staat er na elke slice iets releasebaars en blijft
  het oude pad werken tot het nieuwe bewezen is.
- **Proactieve meldingen (templates) en een token-/nummer-gezondheidscheck zijn
  bewust uitgesteld** — met de Cloud API is het oorspronkelijke "waarschuw me"-doel
  grotendeels overbodig.
