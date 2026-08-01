---
id: meer-gebruikers
titel: Meerdere gebruikers
status: refined
aangemaakt: 2026-07-30
gerefined: 2026-08-01
---

# Meerdere gebruikers

## Samenvatting

De assistent leert wie er stuurt. De platte allowlist ("mag / mag niet") wordt
een echte **gebruikersidentiteit**: een huishoudlid met een naam, een rol en een
eigen ruimte voor gegevens. De app herkent de afzender (slice 1), past aan wie
wát mag op basis van rol (slice 2), en geeft iedere gebruiker eigen context
(slice 3). Gebruikers leven in de database, in prod gevuld vanuit
`prod.secrets.env` zodat echte nummers nooit in git staan.

## Functionele architectuur

### Gedrag

De assistent begroet en behandelt iedereen als zichzelf:

```
vrouw:   hallo
factory: Hallo Naomi!

dochter: hallo
factory: Hallo Lynn!

onbekend nummer: hallo
factory: (stilte — onbekende afzenders worden genegeerd, zoals nu)
```

Rollen bepalen wat je mag (slice 2):

```
Naomi (owner):  gebruikers
factory:        Huishouden:
                - Gijs (owner)
                - Naomi (owner)
                - Lynn (member)

Lynn (member):  gebruikers
factory:        Dat commando ken ik niet. Stuur 'help' voor de mogelijkheden.
```

Iedere gebruiker heeft eigen context (slice 3):

```
Naomi:   onthoud melk kopen
factory: Genoteerd.

Naomi:   notities
factory: Jouw notities:
         - melk kopen

Lynn:    notities
factory: Je hebt nog geen notities.
```

### Regels en randgevallen

- **Machtiging = identiteit.** Een afzender mag commando's sturen dán en slechts
  dán als er een gebruiker voor zijn nummer bestaat. Dit vervangt de losse
  allowlist: "ken ik je" en "mag je sturen" worden één vraag. Onbekende afzenders
  worden nog steeds volledig stil genegeerd (geen antwoord, geen bevestiging).
- **Herkenning bij naam** komt uit de gebruiker zelf, niet meer uit een losse
  contacts-rij: een gemachtigd nummer ís een bekende gebruiker, dus de
  "ik ken je nog niet"-tak vervalt voor WhatsApp. De `contacts`-tabel blijft voor
  de begroeting op http/cli (waar geen identiteit bestaat).
- **Rollen zijn een kleine hiërarchie:** `owner` > `member`. Een commando kan een
  minimumrol eisen (`requiredRole`). Heb je die niet, dan bestaat het commando
  voor jou niet — precies zoals een uitgeschakelde flag: het staat niet in `help`
  en een directe aanroep krijgt `UNKNOWN_COMMAND_REPLY`. Zo lekt het bestaan van
  een owner-commando niet naar een member.
- **Eigen context per functie, niet globaal.** De opslag is per gebruiker
  gescoped (via een `user_id`), maar of een functie per persoon of gedeeld is,
  blijft een keuze per functie. Slice 3 levert het mechanisme plus één voorbeeld
  (`onthoud`/`notities`); het `message_log` (per `participant`) geeft "eigen
  historie" al impliciet.
- **Kanalen zonder identiteit:** op http/cli wordt de afzender opgezocht als
  gebruiker net als op WhatsApp (`(kanaal, handle)`), maar in prod bestaan daar
  geen gebruikers, dus `context.user` is er leeg. Commando's die een gebruiker
  eisen (rol of eigen context) melden dan netjes dat ze de afzender niet kennen.
  In dev/test kunnen fixtures wél http-gebruikers geven, zodat het gedrag e2e
  toetsbaar is.
- **Onbekende afzender-normalisatie:** nummers matchen op hun cijfers vóór
  `@c.us` (zoals nu in `normalizeWhatsAppHandle`), zodat `+31 6 …`, `316…@c.us`
  en `316…` op elkaar vallen.

### Wat het expliciet níet doet

- **Geen zelfregistratie.** Je wordt geen gebruiker door te sturen; iemand
  toevoegen gebeurt in `prod.secrets.env` (en na bootstrap in de database). Een
  onbekend nummer blijft onbekend.
- **Geen gebruikersbeheer vanuit de beheer-console.** De database maakt dat later
  mogelijk, maar het beheren van gebruikers (toevoegen/verwijderen/rol wijzigen
  via een endpoint of het console) is een apart, later item. Nu is de config de
  bron van waarheid, bij het opstarten in de database gezet.
- **Geen groepsgesprekken.** Herkenning binnen een groep hangt samen met, maar
  valt onder het aparte item `whatsapp-groepen`.
- **Geen fijnmazige rechten of eigen rollen.** Alleen de vaste hiërarchie
  `owner`/`member`. Meer rollen of per-commando-ACL's zijn later, als de behoefte
  concreet is.
- **Geen migratie van bestaande context.** Er is nog geen per-persoon data om te
  migreren; slice 3 begint leeg.

## Technische architectuur

### Onderdelen

| Laag | Bestand                            | Wat er verandert                                                                                                                                                             |
| ---- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| db   | `app/src/db/schema.ts`             | Slice 1: nieuwe tabel `users` (`(channel, handle)` uniek, `display_name`, `role`, `created_at`). Slice 3: nieuwe tabel `user_notes` (`user_id` → `users.id`).                |
| core | `app/src/core/users.ts`            | Nieuw. `User`, `Role`, `UserRepository` (`find(channel, handle)`, `list()`), `bootstrapUsers(...)` (upsert vanuit config), en `normalizeWhatsAppHandle` (hierheen).          |
| core | `app/src/core/authorizations.ts`   | Vervalt: machtiging wordt "bestaat er een gebruiker". De inbound-handler gebruikt `UserRepository` in plaats van `Authorizations`.                                           |
| core | `app/src/core/whatsapp-inbound.ts` | Machtiging via `users.find('whatsapp', from)`; de gevonden `User` gaat mee de afhandeling in.                                                                                |
| core | `app/src/core/command-router.ts`   | `CommandContext` krijgt `user: User \| undefined` (opgezocht per bericht). `Command` krijgt `requiredRole?: Role`; `available()`/`route()` handhaven rol (slice 2).          |
| core | `app/src/core/commands.ts`         | `hallo` groet via `context.user` (val terug op `contacts`). Slice 2: `gebruikers` (owner-only). Slice 3: `onthoud`/`notities`.                                               |
| core | `app/src/core/notes.ts`            | Slice 3. Nieuw. `NoteRepository` (`add(userId, text, now)`, `listFor(userId)`): per gebruiker gescopte opslag.                                                               |
| —    | `app/src/config.ts`                | `WHATSAPP_USERS` (komma-gescheiden `handle:naam:rol`) → `config.whatsappUsers`. `WHATSAPP_ALLOWLIST` blijft als terugval zolang `WHATSAPP_USERS` leeg is (veilig uitrollen). |
| —    | `app/src/app.ts`                   | Bouwt `UserRepository`, draait `bootstrapUsers` en hangt `users` in de router-context en de inbound-handler. `notes` erbij in slice 3.                                       |
| db   | `app/src/db/testdata.ts`           | Laadt `users.json` (en slice 3 `user-notes.json`) uit fixtures, net als `contacts.json`.                                                                                     |

De adapter en de router blijven dun: identiteit wordt één keer opgezocht en als
`user` doorgegeven; de beslissingen (mag deze rol dit commando, van wie is deze
notitie) staan in `core/`, conform de lagen in `CODING_GUIDELINES.md`.

### Datamodel

Twee nieuwe tabellen, elk met een migratie via `pnpm db:generate` (nooit met de
hand):

- **`users`** (slice 1): `id` (pk), `channel`, `handle`, `display_name`, `role`
  (`owner`/`member`), `created_at`. Unieke index op `(channel, handle)`, net als
  `contacts`. `role` wordt in code met Zod gevalideerd bij het inlezen.
- **`user_notes`** (slice 3): `id` (pk), `user_id` (→ `users.id`), `text`,
  `created_at`. De scoping-sleutel voor "eigen context".

**Vullen van `users`:**

- **dev/test:** uit `app/test/fixtures/users.json` (nepnummers), via `loadTestData`.
- **prod:** uit `config.whatsappUsers`, bij het opstarten ge-upsert door
  `bootstrapUsers` (op `(channel, handle)`). Zo staan echte nummers alleen in
  `prod.secrets.env` en in de prod-database — nooit in git, en zonder de op prod
  geblokkeerde `seed`. Config is voorlopig de bron van waarheid; een herstart zet
  de tabel terug naar de config.

`WHATSAPP_USERS`-formaat (voorbeeld met nepnummers; echte in `prod.secrets.env`):

```
WHATSAPP_USERS=31600000001:Gijs:owner,31600000002:Naomi:owner,31600000003:Lynn:member
```

Komma tussen gebruikers, dubbele punt tussen velden; de rol is optioneel en
standaard `member`. Namen bevatten geen komma of dubbele punt.

### Externe koppelingen

**Geen nieuwe.** Er komt geen uitgaande dienst bij; alles speelt zich af binnen
het bestaande WhatsApp-kanaal en de database. Dus geen nieuw Pact-contract (dat
legt request/response van uitgaande HTTP vast, en dit is dat niet).

### Feature flag

- **Slice 1 (identiteit):** geen flag. De env-variabele is de schakelaar: zolang
  `WHATSAPP_USERS` leeg is, valt de app terug op `WHATSAPP_ALLOWLIST` en gedraagt
  zich exact als nu. Uitrollen verandert dus niets tot je de gebruikers vult.
- **Slice 2:** `gebruikers` (het owner-only voorbeeldcommando), standaard uit in
  prod. Rolhandhaving zelf is inert tot een commando een `requiredRole` opgeeft.
- **Slice 3:** `notities` (voor `onthoud`/`notities`), standaard uit in prod.

## Slices

### Slice 1 — Identiteit: de app weet wie er stuurt

- **Doel:** de assistent herkent elke gemachtigde afzender als een gebruiker met
  een naam, begroet bij die naam, en geeft de identiteit door aan elk commando.
  Machtiging loopt voortaan via de gebruikerslijst.
- **Acceptatiecriteria:**
  - [x] Er is een `users`-tabel; in prod gevuld vanuit `WHATSAPP_USERS`
        (bootstrap bij opstart), in dev/test uit `users.json`.
  - [x] Een afzender met een gebruiker wordt afgehandeld; een afzender zonder
        gebruiker krijgt geen enkel antwoord (stil genegeerd, zoals nu).
  - [x] `hallo` groet bij de naam uit de gebruiker (`Hallo <naam>!`); op http/cli
        valt het terug op de `contacts`-tabel.
  - [x] Elk commando kan de afzender-identiteit lezen via `context.user`.
  - [x] Met lege `WHATSAPP_USERS` gedraagt prod zich als vandaag (terugval op
        `WHATSAPP_ALLOWLIST`).
- **Tests:** unit: `users` (find/normalisatie, bootstrap-upsert idempotent) ·
  `whatsapp-inbound` tegen fake repo (bekende gebruiker → afgehandeld + begroet;
  onbekend → stil) · `hallo` (naam uit user, terugval op contacts) · contract:
  n.v.t. · e2e: http-bericht van een fixture-gebruiker wordt bij naam begroet
- **Testdata:** `users.json` met nep http- én whatsapp-gebruikers; de
  whatsapp-rij in `contacts.json` mag weg (identiteit levert de naam nu).
- **Flag:** geen (env-gestuurd, veilige terugval).

### Slice 2 — Rollen: wie mag wát

- **Doel:** commando's kunnen een minimumrol eisen; een gebruiker ziet en gebruikt
  alleen wat bij zijn rol past.
- **Acceptatiecriteria:**
  - [ ] `Command` kent een optionele `requiredRole`; de router toont en routeert
        een rol-commando alleen voor een gebruiker met voldoende rol.
  - [ ] Een member die een owner-commando stuurt krijgt `UNKNOWN_COMMAND_REPLY`;
        het commando staat ook niet in zijn `help`.
  - [ ] Het voorbeeldcommando `gebruikers` (owner-only, achter flag `gebruikers`)
        toont de huishoudleden met naam en rol (geen nummers).
- **Tests:** unit: router-rolhandhaving (owner ziet/gebruikt; member geweigerd;
  `help` filtert op rol) · `gebruikers`-commando · contract: n.v.t. · e2e: via
  fixture-gebruikers op http (owner vs member) het verschil in `help` en aanroep
- **Testdata:** een owner- en een member-gebruiker in `users.json`.
- **Flag:** `gebruikers` (uit in prod tot gewenst).

### Slice 3 — Eigen context per persoon

- **Doel:** iedere gebruiker heeft een eigen, gescheiden ruimte; aangetoond met
  een notitiefunctie die per persoon apart is.
- **Acceptatiecriteria:**
  - [ ] Er is een `user_notes`-tabel gekoppeld aan `users`.
  - [ ] `onthoud <tekst>` bewaart een notitie voor de afzender; `notities` toont
        alleen diens eigen notities. Twee gebruikers zien elkaars notities niet.
  - [ ] Een afzender zonder gebruiker (bijv. http in prod) krijgt een nette
        melding dat de assistent hem niet kent, geen crash.
  - [ ] Beide commando's zitten achter flag `notities`.
- **Tests:** unit: `notes` (add/listFor, scheiding per gebruiker) en de twee
  commando's · contract: n.v.t. · e2e: twee fixture-gebruikers op http leggen elk
  een notitie en lezen alleen hun eigen lijst terug
- **Testdata:** `user-notes.json` (leeg of een enkele nep-notitie) en de
  fixture-gebruikers uit slice 1/2.
- **Flag:** `notities` (uit in prod tot gewenst).

## Risico's

- **Config vs. database als bron van waarheid.** Bootstrap upsert bij elke start
  vanuit `WHATSAPP_USERS`; een latere handmatige of console-wijziging in de
  database wordt bij een herstart overschreven. Bewust voor nu (config is bron);
  het aparte item voor gebruikersbeheer lost de overdracht op. Vastgelegd zodat we
  die discussie niet opnieuw voeren.
- **Echte nummers.** Staan alleen in `prod.secrets.env` (`WHATSAPP_USERS`) en de
  prod-database (buiten git). Fixtures gebruiken uitsluitend nepnummers. Bij de
  slice-1-deploy migreer je `WHATSAPP_ALLOWLIST` → `WHATSAPP_USERS` in de
  secrets; de terugval maakt dat je dat rustig kunt doen.
- **Rol alleen zinvol waar identiteit bestaat.** Op http/cli in prod is er geen
  gebruiker, dus owner-commando's werken daar niet — bedoeld (dev-kanalen). E2e
  dekt de rollen via fixture-gebruikers, niet tegen echt WhatsApp (dat blijft
  handmatige acceptatie, zoals bij `whatsapp-kanaal`).
- **Twee migraties over de slices heen.** `users` (slice 1) en `user_notes`
  (slice 3) apart genereren met `pnpm db:generate`; niet vooruitlopen.
- **Naambotsing allowlist/contacts.** De whatsapp-`contacts`-rij vervalt; let op
  dat geen test nog op die rij leunt voor de whatsapp-begroeting.

## Besluiten

- **Gebruikers in de database** (jouw keuze), `(channel, handle)`-gescoped zoals
  `contacts`, met een rol en als ankerpunt voor eigen data. In prod gevuld vanuit
  `prod.secrets.env` via bootstrap, in dev/test uit fixtures — echte nummers
  blijven buiten git en de op prod geblokkeerde `seed` is niet nodig.
- **Machtiging = identiteit.** Een bekende WhatsApp-gebruiker is gemachtigd; dit
  vervangt de platte allowlist en beantwoordt de vraag uit het idee over de
  scheiding allowlist/contacts: ze worden één identiteit. Terugval op
  `WHATSAPP_ALLOWLIST` maakt de overstap veilig.
- **Rollen als kleine hiërarchie** (`owner`/`member`) met `requiredRole` per
  commando; onvoldoende rol = commando bestaat niet (zoals een flag). Geen
  fijnmazige ACL's tot de behoefte concreet is.
- **Eigen context via een gescopte `user_notes`-tabel** met `onthoud`/`notities`
  als eerste voorbeeld; andere functies mogen gedeeld blijven — het mechanisme
  maakt de mix mogelijk, per functie te kiezen.
- **Drie slices,** elk zelfstandig af en uit te rollen: identiteit (env-gestuurd,
  veilige terugval), dan rollen (achter een voorbeeldflag), dan eigen context
  (achter een flag).
- **Buiten scope:** groepen (`whatsapp-groepen`) en gebruikersbeheer vanuit de
  beheer-console (later item). Geen nieuwe externe koppeling, dus geen nieuw Pact.
