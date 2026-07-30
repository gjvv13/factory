# Coding guidelines

Deze regels bestaan om één reden: dat je over een half jaar nog snapt wat er staat
en het zonder angst kunt veranderen. Wat afdwingbaar is, staat in ESLint, Prettier
en de strikte `tsconfig.json` — de rest staat hier.

## Lagen

Code hoort in precies één laag, en afhankelijkheden gaan alleen naar binnen:

```
channels/  clients/  http/      ← buitenkant: praten met de wereld
      ↓        ↓       ↓
            core/                ← domeinlogica en beslissingen
              ↓
             db/                 ← opslag
```

- **`core/`** bevat de beslissingen: welk commando doet wat, wat wordt geantwoord.
  Deze laag doet geen netwerk-I/O, kent geen Fastify en leest geen omgevingsvariabelen.
- **`channels/`** zijn dunne adapters. Ze zetten iets van buiten (HTTP, terminal,
  later WhatsApp) om in een `InboundMessage` en geven dat aan `MessageService`.
  Zit er logica in een adapter, dan hoort die in `core/`.
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

## Namen

- Bestanden en mappen: `kebab-case.ts`.
- Nederlandse termen in dingen die de gebruiker ziet (antwoorden, scripts,
  foutmeldingen, documentatie). Engelse termen in code-identifiers, omdat die
  bij de taal en de bibliotheken passen. Consistent binnen een bestand.
- Functies die iets teruggeven heten naar wat ze teruggeven (`readVersion`),
  functies die iets doen naar de handeling (`recordInbound`).

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
uit in productie. Een commando met `flagKey` bestaat niet als de flag uit staat.
Ruim een flag op zodra de functie definitief is — een flag die niemand meer omzet
is dode code met extra stappen.

## Commits

Kleine commits met een zin die zegt wat er verandert en waarom, in de
gebiedende wijs: `voeg ping-commando toe achter feature flag`. Elke commit
gaat door de pre-commit poort; `--no-verify` alleen als je weet waarom.
