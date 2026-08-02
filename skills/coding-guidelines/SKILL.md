---
name: coding-guidelines
description: >-
  De coding guidelines van de software factory. Gebruik deze skill bij het
  schrijven, nakijken of herstructureren van code in een factory-applicatie (een
  TypeScript-backend met een app/src-map, Fastify, Drizzle en Vitest). Trigger
  op het toevoegen of wijzigen van een route, service, commando, kanaal, migratie,
  client of test, op het bouwen van een slice, en op vragen als "waar hoort dit thuis",
  "hoe test ik dit" of "klopt dit met onze afspraken". Pas de skill ook toe
  zonder dat erom gevraagd wordt zodra er code voor de applicatie ontstaat.
---

# Coding guidelines

Deze regels bestaan om één reden: dat je over een half jaar nog snapt wat er staat
en het zonder angst kunt veranderen. Wat afdwingbaar is, staat in ESLint, Prettier
en de strikte `tsconfig.json` (allemaal uit het factory-pakket) — de rest staat hier.

Houd je hieraan zodra je code voor een factory-applicatie schrijft of wijzigt, ook
als niemand er expliciet om vraagt. Twijfel je of iets mag, dan is de laag-indeling
hieronder leidend.

## Lagen

Code hoort in precies één laag, en afhankelijkheden gaan alleen naar binnen:

```
channels/  clients/  http/      ← buitenkant: praten met de wereld
      ↓        ↓       ↓
            core/                ← domeinlogica en beslissingen
              ↓
             db/                 ← opslag
```

- **`core/`** bevat de domeinlogica en de beslissingen: wat er met de invoer gebeurt
  en wat er teruggaat. Bij een app die berichten verwerkt is dat "welk commando doet
  wat"; bij een console zijn het services (een overzicht opbouwen, een flag omzetten).
  Deze laag doet geen netwerk-I/O, kent geen Fastify en leest geen omgevingsvariabelen.
- **`channels/`** is de laag voor apps die inkomende berichten verwerken: dunne
  adapters die iets van buiten (HTTP, terminal, later WhatsApp) omzetten in een
  `InboundMessage` en aan de `MessageService` in `core/` geven. Een app zonder
  inkomende berichten (een console, een tool) heeft deze laag niet. Zit er logica in
  een adapter, dan hoort die in `core/`.
- **`http/`** valideert invoer, roept `core/` aan en maakt een respons. Niets meer.
- **`db/`** bevat schema, migraties en het inlezen van testdata. Queries staan in
  repositories in `core/`, zodat de rest van de code geen SQL of Drizzle ziet.
- **`clients/`** bevat uitgaande koppelingen. Elke externe verbinding krijgt een
  contract test.

## Afhankelijkheden expliciet maken

Alles wordt in `app/src/app.ts` geconstrueerd en doorgegeven. Modules maken hun
eigen afhankelijkheden niet aan — geen singletons, geen imports van een globale
database. Dat maakt elke module testbaar zonder mocks van de halve wereld.

Tijd komt uit `Clock` (`core/clock.ts`). `new Date()` in domeincode wordt door
ESLint geweigerd; anders is gedrag rond tijd niet te testen.

## Types

- `strict` staat aan, inclusief `noUncheckedIndexedAccess` en
  `exactOptionalPropertyTypes`. Geen `any`, geen `as` om een fout weg te duwen.
- Invoer van buiten (HTTP-body, omgevingsvariabelen, JSON-bestanden) wordt
  gevalideerd met Zod voordat het het domein binnenkomt. Binnen het domein
  vertrouwen we types; op de grens vertrouwen we niets.
- Exporteer types met `export type` en importeer ze met `import type`.

## Naamgeving

- Bestanden en mappen: `kebab-case.ts`.
- Nederlands voor alles wat de gebruiker ziet — antwoorden, scripts,
  foutmeldingen, documentatie — en voor comments en JSDoc.
- **Identifiers: Engels als standaard, Nederlands voor zuivere domeinbegrippen.**
  De code praat grotendeels de taal van het vak en de bibliotheken; Nederlands
  reserveren we voor begrippen uit het probleemdomein zelf.
  - **Engels** — structuur, techniek, patronen en alles wat een externe API,
    bibliotheek, HTTP of SQL dicteert: `MessageService`, `CommandRouter`,
    `HttpClient`, `Repository`, `InboundMessage`, `FeatureFlag`.
  - **Nederlands** — begrippen uit het gezinsdomein die geen gangbare technische
    tegenhanger hebben: `boodschap`, `boodschappenlijst`, `herinnering`,
    `gezinslid`, `kandidaat`.
  - **Letterlijk overgenomen extern → Engels**, ook als het domein-achtig klinkt:
    veldnamen uit een externe API, HTTP-headers, kolomnamen die een bibliotheek
    bepaalt.
  - **Twijfel je of iets domein of techniek is, sluit dan aan bij de omringende
    code.** In de praktijk is dat Engels; blijf in elk geval consistent binnen
    één bestand.
- Functies die iets teruggeven heten naar wat ze teruggeven (`readVersion`),
  functies die iets doen naar de handeling (`recordInbound`).
- Bestaande namen ruim je mee op wanneer je een bestand tóch aanraakt — geen
  aparte hernoemronde.

## Fouten

- Gooi `Error` met een bericht dat zegt wat er misging én in welke context.
  Eigen fouttypes (zoals `HttpRequestError`) alleen als de aanroeper er
  anders op moet reageren.
- Faal hard bij een verkeerd geconfigureerde omgeving: half opstarten is erger
  dan niet opstarten.
- Vang nooit een fout om hem stil te laten verdwijnen. Loggen en doorgooien mag.

## Commentaar

Schrijf op waaróm iets zo is, niet wat de regel doet. Geen commentaar dat een
naam herhaalt. Wel commentaar bij een keuze die een lezer zou willen aanvechten.

## Tests

- Elke slice levert tests op. Een slice zonder tests is niet af.
- **Unit** (`app/test/unit/`): domeinlogica, snel, in-memory database.
- **Contract** (`app/test/contract/`): elke uitgaande verbinding krijgt een
  Pact-contract. Nieuwe externe koppeling betekent nieuw contract.
- **End to end** (`app/test/e2e/`): tegen een echt gestarte applicatie over HTTP.
- Testdata staat in `app/test/fixtures/` en wordt vóór elke test opnieuw
  ingelezen. Tests mogen nooit afhangen van wat een vorige test achterliet.
- Test gedrag, niet implementatie. De naam van een test beschrijft het gedrag
  in een hele zin.

## Feature flags

Nieuwe functionaliteit die je nog niet vertrouwt gaat achter een flag, standaard
uit in productie. Wat een `flagKey` draagt — een commando, een route — bestaat niet
zolang de flag uit staat: het valt ook uit `help` of de API weg.
Ruim een flag op zodra de functie definitief is — een flag die niemand meer omzet
is dode code met extra stappen.

## Commits

Kleine commits met een zin die zegt wat er verandert en waarom, in de
gebiedende wijs: `voeg een time-out toe aan de mail-client omdat een trage host
anders alles blokkeert`. Elke commit gaat door de pre-commit poort; `--no-verify`
alleen als je weet waarom.
