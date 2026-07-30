---
id: whatsapp-kanaal
titel: WhatsApp als kanaal
status: refined
aangemaakt: 2026-07-30
gerefined: 2026-07-30
---

# WhatsApp als kanaal

## Samenvatting

De applicatie is straks te bedienen door een WhatsApp-bericht naar het eigen
nummer te sturen, in plaats van via curl of de terminal. WhatsApp wordt een
`ChannelAdapter` naast HTTP en CLI: hij ontvangt berichten van gemachtigde
nummers, laat `MessageService` het commando afhandelen en stuurt het antwoord
terug. Alleen prod koppelt aan een echt nummer, achter feature flag
`whatsapp-channel`, met een aparte allowlist die bepaalt wie commando's mag sturen.

## Functionele architectuur

### Gedrag

Een gemachtigd nummer stuurt een bericht; de applicatie antwoordt zoals elk
ander kanaal al doet:

```
ik:      ping
factory: pong

ik:      hallo
factory: Hallo <mijn naam>!

ik:      help
factory: Ik kan dit:
         - help: Laat de beschikbare commandos zien.
         - ping: Antwoordt met pong.
         - ...
```

Een onbekend commando krijgt hetzelfde antwoord als op de andere kanalen
(`UNKNOWN_COMMAND_REPLY`). Een bericht van een **niet-gemachtigd** nummer krijgt
geen enkel antwoord — de applicatie zwijgt volledig.

Tijdens acceptatie op prod, met de flag nog uit, is de adapter wél verbonden en
logt hij het inkomende verkeer, maar antwoordt hij niet. Zo kun je op het echte
nummer bevestigen dat de koppeling en de ontvangst kloppen vóór je hem live zet.

### Koppelen en contact leggen

`whatsapp-web.js` maakt geen bot-nummer aan; het koppelt zich als _gekoppeld
apparaat_ aan een bestaand WhatsApp-account, net als WhatsApp Web. De applicatie
"is" dus een WhatsApp-account, en de vraag is welk.

**Keuze: een apart assistent-nummer**, niet het persoonlijke nummer van de
gebruiker. Reden: `meer-gebruikers` en `whatsapp-groepen` kunnen alleen als de
assistent een eigen WhatsApp-identiteit heeft; koppelen aan een persoonlijk
account zou bovendien álle privéchats zichtbaar maken. Dit scherpt "naar mijn
eigen nummer" uit het oorspronkelijke idee aan.

- **Het assistent-nummer** is het account waaraan de app gekoppeld wordt (de QR
  die je scant). Dit nummer staat nergens in de allowlist.
- **De allowlist** (`WHATSAPP_ALLOWLIST`) bevat de persoonlijke nummers die
  commando's mogen sturen — eerst alleen de eigenaar, later vrouw en dochter.

Eenmalige koppeling (op prod):

1. Zorg dat het assistent-nummer een geregistreerd WhatsApp-account heeft: eSIM
   in een toestel, WhatsApp installeren, nummer verifiëren via de sms-code. Een
   gloednieuw nummer moet deze stap eerst.
2. Start prod met `CHANNEL=whatsapp`; de app toont een QR in de logs.
3. Op het assistent-toestel: WhatsApp → Gekoppelde apparaten → scan de QR.
4. De sessie blijft in `.whatsapp-session/`; na herstart is geen nieuwe scan nodig.

Daarna stuurt een gemachtigd nummer gewoon een chatbericht naar het
assistent-nummer; het antwoord komt in dezelfde chat terug.

De echte nummers (assistent én allowlist) staan alleen in
`environments/prod.secrets.env` (buiten git), nooit in deze publieke repo.

### Regels en randgevallen

- **Afzenderfilter:** alleen nummers in de allowlist worden verwerkt. Een
  bericht van een ander nummer wordt stil genegeerd (geen reply, geen
  bevestiging dat het nummer bestaat).
- **Volgorde in de inbound-afhandeling:** eerst afzenderfilter, dan flag, dan
  routeren. Onbekende afzenders worden dus ook tijdens de "verbonden-maar-stil"
  acceptatiestap genegeerd; alleen het gemachtigde nummer verschijnt in de logs.
- **Flag uit:** de adapter verbindt en logt inkomend verkeer via de logger, maar
  routeert niet en antwoordt niet.
- **Begroeting bij naam:** `hallo` groet alleen bij naam als het nummer óók als
  contact bekend staat (`channel = whatsapp`). Machtiging (allowlist) en
  herkenning (contacts) zijn bewust gescheiden: een gemachtigd nummer dat niet in
  contacts staat krijgt "Hallo! Ik ken je nog niet."
- **Sessieverlies / herstart:** de sessie staat op schijf in `.whatsapp-session/`
  (al genegeerd in git). Na een herstart wordt de sessie hergebruikt zonder
  opnieuw scannen. Raakt de sessie ongeldig, dan logt de adapter duidelijk dat
  opnieuw scannen nodig is en blijft het proces overeind (geen crash-loop onder
  pm2). Robuust herverbinden zit in slice 2.
- **Antwoord bevat meerdere regels:** één `OutboundMessage` per antwoord,
  verstuurd als één WhatsApp-bericht (de router levert al platte tekst met `\n`).

### Wat het expliciet níet doet

- Geen bediening op dev en acc via WhatsApp: die blijven op het HTTP-kanaal.
  Eén WhatsApp-sessie hoort bij één nummer, en dat nummer is van prod.
- Geen ongevraagde berichten of notificaties uit de applicatie. `send()` bestaat
  op de adapter (het kanaal ondersteunt het technisch), maar geen enkel commando
  gebruikt het in deze twee slices.
- Geen groepsgesprekken, media, reacties of statusberichten — alleen
  tekstberichten van een gemachtigd één-op-één-nummer.
- Geen migratie naar de officiële WhatsApp Cloud API. De port-opzet houdt die
  overstap klein, maar hij valt buiten deze slices.

## Technische architectuur

### Onderdelen

| Laag     | Bestand                                | Wat er verandert                                                                                                                             |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| channels | `app/src/channels/whatsapp-channel.ts` | Nieuw. Definieert de port `WhatsAppClient`, een echte wrapper over `whatsapp-web.js`, en `createWhatsAppChannel(...)` (ChannelAdapter).      |
| core     | `app/src/core/authorizations.ts`       | Nieuw. `createAuthorizations(allowed)` met `isAllowed(handle)`: de beslissing wie mag sturen, datagestuurd en zonder I/O.                    |
| core     | `app/src/config.ts`                    | `CHANNEL`-enum uitgebreid met `whatsapp`; nieuwe, met Zod gevalideerde `WHATSAPP_ALLOWLIST` (komma-gescheiden) → `config.whatsappAllowlist`. |
| —        | `app/src/app.ts`                       | Bouwt `authorizations` uit `config.whatsappAllowlist` en hangt het in de compositieroot.                                                     |
| —        | `app/src/main.ts`                      | Bij `CHANNEL=whatsapp`: echte `whatsapp-web.js`-client + WhatsApp-kanaal construeren en starten.                                             |
| http     | `app/src/http/routes/health.ts`        | Slice 2: verbindingsstatus van het WhatsApp-kanaal erbij (`connected` / `connecting` / `needs-qr` / `disconnected`).                         |

De adapter blijft dun: hij normaliseert de afzender, vraagt `authorizations` en
`flags` om de beslissing, en laat `MessageService` het commando afhandelen. De
beslissingen zelf staan in `core/`, conform de lagen in `CODING_GUIDELINES.md`.

### Datamodel

**Geen migratie nodig.** Alle bestaande tabellen volstaan:

- `message_log` is al kanaalonafhankelijk — WhatsApp-verkeer valt onder
  `channel = whatsapp`.
- `contacts` levert de begroeting bij naam via `(channel, handle)`; er komt een
  `whatsapp`-rij bij in de fixtures voor de tests, plus jouw echte nummer als
  contact in prod als je bij naam begroet wilt worden.
- De allowlist komt niet uit de database maar uit config (zie hieronder), zodat
  het echte prod-nummer niet in git of in seed-fixtures belandt.

Het afzender-handle is het `whatsapp-web.js`-id in de vorm `<nummer>@c.us`. Dat
is de kanaalspecifieke identificatie (`InboundMessage.from`) en dezelfde vorm
staat in de allowlist en in de `contacts`-rij.

### Externe koppelingen

`whatsapp-web.js` is een **kanaal**, geen `clients/`-koppeling: de verbinding is
tweerichting en event-gedreven (WhatsApp levert berichten bij óns af). Daarom is
er geen Pact-contract — Pact legt request/response van uitgaande HTTP vast, en dit
is dat niet. De bestaande kanalen (`http`, `cli`, `fake`) hebben om dezelfde reden
geen contract test.

Het "contract" dat we vastpinnen is de port `WhatsAppClient`: een smalle interface
(`onMessage(handler)`, `sendMessage(to, text)`, `onStateChange(handler)`, `start()`,
`stop()`) met één echte implementatie over `whatsapp-web.js` en één fake voor de
tests. De adapterlogica wordt volledig unit-getest tegen die fake; de dunne echte
wrapper wordt handmatig geverifieerd op prod achter de flag. De port houdt bovendien
de eerder genoemde overstap naar de Cloud API klein: alleen de implementatie wisselt.

`whatsapp-web.js` trekt puppeteer/Chromium mee. Dat draait headless onder pm2 op
de prod-Mac; zie Risico's voor de aandachtspunten.

### Feature flag

`whatsapp-channel` (bestaat al in `feature-flags.json`, standaard uit). De vlag
bepaalt of de adapter **antwoordt**: uit = verbonden en loggend maar stil, aan =
live. `CHANNEL=whatsapp` in `prod.env` is de losse deploy-schakelaar die de
adapter start. De vlag mag in prod aan zodra slice 1 op het echte nummer gekoppeld
is en de logs bevestigen dat inkomend verkeer klopt; slice 2 maakt de verbinding
robuust genoeg om hem aan te laten staan.

## Slices

### Slice 1 — WhatsApp-adapter: verbinden, ontvangen, antwoorden, met afzenderfilter

- **Doel:** een gemachtigd nummer kan de applicatie via WhatsApp bedienen. Na
  deze slice kan prod met `CHANNEL=whatsapp` draaien, gekoppeld aan het echte
  nummer, en — flag aan — antwoorden op commando's.
- **Acceptatiecriteria:**
  - [ ] `CHANNEL` accepteert `whatsapp`; `main.ts` start dan het WhatsApp-kanaal.
  - [ ] Bij eerste koppeling wordt een QR getoond; de sessie wordt bewaard in
        `.whatsapp-session/` en na herstart hergebruikt zonder opnieuw scannen.
  - [ ] Een bericht van een gemachtigd nummer wordt door `MessageService`
        afgehandeld en het antwoord gaat terug via WhatsApp (`ping` → `pong`).
  - [ ] Een bericht van een niet-gemachtigd nummer levert geen enkel antwoord op.
  - [ ] Met de flag uit antwoordt de adapter niet, maar logt hij het inkomende
        bericht van het gemachtigde nummer.
  - [ ] In- en uitgaand WhatsApp-verkeer verschijnt in `message_log` onder
        `channel = whatsapp` (bij flag aan).
- **Tests:** unit: `authorizations` (allowlist toestaan/weigeren, normalisatie)
  en `whatsapp-channel` tegen een fake `WhatsAppClient` (gemachtigd + flag aan →
  antwoord verstuurd; niet-gemachtigd → niets; flag uit → niets, wel gelogd;
  antwoordtekst = routerantwoord) · contract: n.v.t. (kanaal, geen client; port +
  adapter-unittests vervangen het contract) · e2e: n.v.t. (prod koppelt als enige
  aan echt WhatsApp; de laag eronder is al e2e-gedekt via HTTP)
- **Testdata:** een `whatsapp`-rij in `contacts.json` (voor begroeting bij naam);
  de allowlist wordt in de unittests inline meegegeven, niet uit fixtures.
- **Flag:** `whatsapp-channel` (blijft uit in prod tot handmatige acceptatie).

### Slice 2 — Robuust herverbinden en zichtbaarheid

- **Doel:** de verbinding overleeft sessieverlies, netwerkonderbrekingen en
  herstarts zonder handmatig ingrijpen, en je kunt de status opvragen.
- **Acceptatiecriteria:**
  - [ ] Bij een verbroken verbinding probeert de adapter opnieuw te verbinden met
        oplopende wachttijd (backoff), zonder het proces te laten crashen.
  - [ ] Raakt de sessie ongeldig, dan logt de adapter duidelijk dat opnieuw
        scannen nodig is en blijft het proces overeind (geen crash-loop onder pm2).
  - [ ] `/health` toont de verbindingsstatus van het WhatsApp-kanaal.
  - [ ] Netjes afsluiten (`stop()`) sluit de puppeteer-verbinding af.
- **Tests:** unit: de fake `WhatsAppClient` zendt `disconnect`/`needs-qr`/`ready`
  events; de adapter verandert van status, plant een herverbinding (met
  geïnjecteerde `Clock` / fake timers, geen echte wachttijd) en biedt de status
  aan · contract: n.v.t. · e2e: `/health` toont het statusveld (uitbreiding van
  de bestaande health-e2e)
- **Testdata:** geen nieuwe fixtures.
- **Flag:** `whatsapp-channel` (mag in prod aan zodra deze slice er is).

## Risico's

- **Blokkade van het nummer:** `whatsapp-web.js` is onofficieel; er is een klein
  risico dat het nummer geblokkeerd wordt. Bewust geaccepteerd (randvoorwaarde in
  het idee). De port-opzet houdt de overstap naar de officiële Cloud API klein.
- **Puppeteer/Chromium onder pm2:** zware afhankelijkheid (~300 MB) die headless
  moet starten. Mogelijk `--no-sandbox` of een expliciet `executablePath` nodig.
  Aandachtspunt bij het eerste echte starten op de prod-Mac; valideren tijdens de
  handmatige acceptatie van slice 1.
- **Node-versie:** `package.json` pint node `>=22 <23`. Controleer dat de
  gekozen `whatsapp-web.js`- en puppeteer-versie daarmee overweg kunnen.
- **Alleen prod koppelt echt:** het vertrouwen in de adapter komt van
  unittests plus handmatige acceptatie op prod achter de flag, niet van e2e tegen
  echt WhatsApp. De "verbonden-maar-stil"-stap maakt die acceptatie veilig.
- **Sessieverlies:** de sessie op de prod-machine kan verloren gaan (schijf,
  WhatsApp-uitlog). Gevolg: één keer opnieuw scannen. Buiten git gehouden.
- **Assistent-nummer nieuw voor WhatsApp:** het gekozen nummer heeft nog geen
  WhatsApp-account en moet eerst geregistreerd worden (sms-verificatie op een
  toestel) voordat koppelen kan.
- **Gekoppeld-apparaat-model:** WhatsApp bindt een gekoppeld apparaat aan een
  primair account. Komt het assistent-toestel te lang (±2 weken) niet online,
  dan verloopt de koppeling en is opnieuw scannen nodig. Het assistent-toestel
  moet dus blijven bestaan en af en toe verbinden.

## Besluiten

- **WhatsApp is een channel, geen client.** Bidirectioneel en event-gedreven, dus
  geen Pact-contract; de port `WhatsAppClient` plus adapter-unittests vervangen het
  contract. Dit volgt de bestaande kanalen (http/cli/fake hebben ook geen contract).
- **Aparte allowlist in `core/`, gevoed uit config** (`WHATSAPP_ALLOWLIST` in
  `prod.secrets.env`), los van de greeting-`contacts`. Reden: "ken ik dit nummer"
  en "mag dit nummer commando's sturen" zijn verschillende vragen, en het echte
  prod-nummer hoort niet in git of seed-fixtures. (Gekozen boven hergebruik van de
  contacts-tabel.)
- **Twee gates.** `CHANNEL=whatsapp` (deploy-schakelaar, start de adapter) en flag
  `whatsapp-channel` (antwoord-schakelaar). Flag uit = verbonden-maar-stil: een
  veilige acceptatiestap op het echte nummer, en aanzetten zonder herstart.
- **Onbekende afzender → stil negeren**, geen afwijzingsbericht: conform "reageren
  op onbekende nummers wil ik niet", en het bevestigt spammers niet dat het nummer
  actief is.
- **Twee slices, niet drie.** De afzenderfilter zit in slice 1: antwoorden op een
  echt nummer zónder filter is geen toestand die je ooit naar prod zou zetten, dus
  het is geen zelfstandige slice.
- **Geen migratie.** `message_log` en `contacts` volstaan; status leeft in
  geheugen, de sessie op schijf in `.whatsapp-session/`.
- **Apart assistent-nummer**, niet het persoonlijke nummer: nodig voor
  `meer-gebruikers`/`whatsapp-groepen` en het voorkomt dat de app privéchats
  ziet. De echte nummers staan alleen in `prod.secrets.env`, buiten deze
  publieke repo.
