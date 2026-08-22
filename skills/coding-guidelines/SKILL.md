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
- **`clients/`** bevat uitgaande koppelingen. Elke uitgaande verbinding krijgt een
  test die het contract vastlegt — welke soort, zie _Tests_.

## Afhankelijkheden expliciet maken

Alles wordt in `app/src/app.ts` geconstrueerd en doorgegeven. Modules maken hun
eigen afhankelijkheden niet aan — geen singletons, geen imports van een globale
database. Dat maakt elke module testbaar zonder mocks van de halve wereld.

Tijd komt uit `Clock` (`core/clock.ts`). `new Date()` in domeincode wordt door
ESLint geweigerd; anders is gedrag rond tijd niet te testen.

## Types

- `strict` staat aan, inclusief `noUncheckedIndexedAccess` en
  `exactOptionalPropertyTypes`. Geen `any`, geen `as` om een fout weg te duwen.
  - Wil je een waarde tóétsen aan een type, gebruik dan `satisfies`: dat
    controleert zonder het type te verbreden of te liegen.
  - Moet je een onbekende waarde smal maken, schrijf dan een type-guard
    (`function isX(waarde: unknown): waarde is X`) of laat Zod het doen. Een
    guard is een controle; een `as` is een belofte die niemand nakijkt.
  - `as unknown as` is nooit goed. Kom je daar toch uit, dan klopt het type
    eronder niet — repareer dat.
- Invoer van buiten (HTTP-body, omgevingsvariabelen, JSON-bestanden,
  brein-output) wordt gevalideerd met Zod voordat het het domein binnenkomt.
  Binnen het domein vertrouwen we types; op de grens vertrouwen we niets.
  - **Brein-output is invoer van buiten.** Het model levert vrije tekst; de
    Zod-parse hoort in `clients/` (niet in `core/`), want het is een
    koppelingsdetail. Faalt de parse, dan is de zekerheid nul — hetzelfde als
    bij te lage zekerheid: niets doen (zie _Natuurlijke taal_).
  - **Grenstypen afleiden uit het schema.** Een domeintype dat uit een
    Zod-schema gevalideerd wordt, wordt afgeleid met
    `z.infer<typeof schema>` — niet met de hand geschreven naast het schema.
    Handgeschreven types driften uiteen zodra het schema verandert. De regel
    geldt alleen voor grenstypen; zuivere domeintypen die geen externe grens
    overschrijden blijven gewoon een `type` of `interface`.

    ```ts
    // clients/claude-client.ts — het schema levert zowel het type als de parse
    const intentieSchema = z.object({
      actie: z.enum(['toevoegen', 'verwijderen', 'tonen']),
      zekerheid: z.number().min(0).max(1),
    });
    type Intentie = z.infer<typeof intentieSchema>;

    const parsed = intentieSchema.safeParse(response);
    if (!parsed.success) return undefined; // zekerheid nul
    ```
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
- Kan de aanroeper er zinnig op reageren, dan is falen geen uitzondering maar een
  **resultaat**: een discriminated union (`{ ok: false, reden }` of een
  domeinspecifieke variant). Het return-type dwingt de aanroeper beide takken af te
  handelen; een `Error` doet dat niet. Kan de aanroeper er níets mee, dan is het een
  bug → gooi `Error` (de regel hierboven).
- In `http/` is het HTTP-antwoord zelf het resultaatkanaal: een statuscode + body.
  Gooi daar geen `Error` voor een 400; antwoord met een 400. De Result-conventie
  geldt voor `core/` en `clients/`.
- Geen gedeeld `Result<T, E>`-type. Per geval een union die past bij het domein.
- Nooit berichtinhoud, namen van personen, tokens of sleutels loggen — op geen enkel
  niveau. Logs op de mini zijn persistente bestanden, geen vluchtige console-uitvoer.
  Log een id, een lengte, een kanaal of een categorie: genoeg om het probleem te
  vinden, niet genoeg om iets persoonlijks te lezen.
- Gebruikersgerichte uitvoer (de CLI die het antwoord toont) is geen log — daar
  gelden de regels van het kanaal, niet van logging.

## Commentaar

Schrijf op waaróm iets zo is, niet wat de regel doet. Geen commentaar dat een
naam herhaalt. Wel commentaar bij een keuze die een lezer zou willen aanvechten.

## Tests

- Elke slice levert tests op. Een slice zonder tests is niet af.
- **Unit** (`app/test/unit/`): domeinlogica, snel, in-memory database.
- **Contract** (`app/test/contract/`): elke uitgaande verbinding wordt hier
  vastgelegd, maar met welk gereedschap hangt af van wie er aan de andere kant zit.
  - **Een van onze eigen apps** (beheer → assistant, assistant → boodschappen):
    een **Pact**. De aanroepende app legt zijn verwachting vast, de leverende app
    verifieert die in zijn eigen poort. Daar is Pact voor gemaakt, en alleen dan
    vangt hij een echte breuk — vóórdat je hem op productie merkt.
  - **Een dienst van derden** (Claude, Matrix, een winkel-API): **geen Pact**.
    Niemand aan die kant verifieert jouw contract, dus levert het alleen een dure
    omweg naar een mock op. Leg de koppeling vast met een opgenomen respons plus
    een Zod-schema op het antwoord: dat toetst wél iets, namelijk dat jouw client
    het antwoord aankan en dat je aannames over het formaat expliciet zijn.

  De regel blijft dus: geen nieuwe uitgaande koppeling zonder test die het contract
  vastlegt. Alleen het gereedschap verschilt.

- **End to end** (`app/test/e2e/`): tegen een echt gestarte applicatie over HTTP.
- **Een test hoort bij een acceptatiecriterium, niet bij een functie.** Voor elk
  criterium van de slice is aanwijsbaar wélke test het toetst. Andersom geldt het ook:
  een test die niets uit de criteria toetst, toetst waarschijnlijk de implementatie.
- **Toets nooit alleen de laag waar je zelf in staat.** Een unit-test die de buitenwereld
  wegstubt bewijst dat jouw code de stub aankan, niet dat de stub klopt. Raakt een
  wijziging een buitengrens (een commando, een API, een schema), dan hoort daar een test
  bij die die grens écht raakt — een contract-test of een e2e. Op 2026-08-19 was een
  jq-expressie in de factory-CLI kapot terwijl alle unit-tests groen stonden: de stub
  verving juist het stuk dat fout was.
- Testdata staat in `app/test/fixtures/` en wordt vóór elke test opnieuw
  ingelezen. Tests mogen nooit afhangen van wat een vorige test achterliet.
- Test gedrag, niet implementatie. De naam van een test beschrijft het gedrag
  in een hele zin.
- **Een test mag nooit van timing afhangen.** De fixtures-regel hierboven dekt
  staat, niet tijd — en dat gat kost een halve dag zodra het toeslaat.
  - Wacht op **alle** gevolgen van je prikkel, niet op het eerste dat langskomt.
    Stuurt een commando een state-wijziging én een antwoord, wacht dan op allebei;
    anders loopt het tweede door in de volgende test.
  - **Match op een id**, niet op volgorde. Draagt het bericht een `eventId` of een
    correlatie-id, laat de wachtvoorwaarde daarop selecteren — dan kan een late
    reactie uit een vorige test per definitie niet meetellen.
  - **Geen `sleep`.** Poll met een deadline, of gebruik de `Clock`.
  - Een test die "meestal" slaagt is kapot. Een rode poort die niets betekent
    leert je om te herdraaien in plaats van te kijken, en juist dat maakt een
    échte regressie later onzichtbaar.
- **Schrijf op wat je bewust níet test.** Dekking is een hulpmiddel, geen doel: de
  goedkoopste manier om een cijfer te halen is een test die de implementatie
  vastpint, en die betaal je terug bij elke refactor. Laat generated code,
  triviale doorgeefluiken en configuratie gerust ongedekt — maar zet er één regel
  bij waarom, zodat het een keuze is en geen gat.

## Feature flags

Nieuwe functionaliteit die je nog niet vertrouwt gaat achter een flag, standaard
uit in productie. Wat een `flagKey` draagt — een commando, een route — bestaat niet
zolang de flag uit staat: het valt ook uit `help` of de API weg.
Ruim een flag op zodra de functie definitief is — een flag die niemand meer omzet
is dode code met extra stappen.

## Natuurlijke taal (het brein)

Alles wat de gebruiker kan, kan hij in **natuurlijke taal** — niet alleen via een
exact commando. Elke gebruikersactie is bereikbaar via het brein (vrije tekst →
intentie); een nieuwe actie zonder natuurlijke-taal-ingang is niet af. Dit geldt
voor elke app en elke epic.

Elke app heeft z'n **eigen** brein, maar volgens één patroon:

- Een provider-neutrale poort in `core/` (tekst → intentie): het domein kent geen
  SDK en geen sleutel.
- Twee implementaties in `clients/`: een deterministische **keyword-stand-in**
  (dev/e2e, geen sleutel nodig) en de echte **Claude-client** met structured
  output. Alleen de gekozen provider wordt dynamisch geladen (config
  `LLM_PROVIDER`), zodat de andere niet in geheugen of dekking komt. De
  Zod-parse van het modelantwoord hoort hier, in `clients/` — zie de
  validatieregel in _Types_.
- De uitkomst is een **intentie met een zekerheid**: bij twijfel navragen in plaats
  van gokken, bij te lage zekerheid niets doen.
- Een intentie voert een **bestaande, deterministische** actie uit (het brein
  synthetiseert een commando/aanroep) — zo blijven machtiging en validatie op één
  plek en test je de actie los van het brein.
- De **terugval is altijd deterministisch**: met het brein uit, zonder sleutel of
  bij een onbereikbaar model mag de kernfunctie niet blokkeren.

Nieuwe of nog niet vertrouwde brein-intenties gaan achter een flag, standaard uit
in productie (zie _Feature flags_).

## Commits

Kleine commits met een zin die zegt wat er verandert en waarom, in de
gebiedende wijs: `voeg een time-out toe aan de mail-client omdat een trage host
anders alles blokkeert`. Elke commit gaat door de pre-commit poort; `--no-verify`
alleen als je weet waarom.

## Klaar

Eén lijst, zodat "is dit af?" geen gesprek achteraf is. Hij geldt per slice: een
slice is zelfstandig af of hij is verkeerd geknipt.

**Wat de poort toetst** — `factory verify`, en daarmee ook `release`:

opmaak, lint, types, unit-, contract- en e2e-tests, de build, de dekking (boven
het minimum én niet onder de basislijn van de ratchet) en de afhankelijkheden
(`pnpm audit`, standaard een gele melding). Rood is niet af. De
pre-commit hook draait hier alleen de snelle helft van; `--no-verify` slaat die
over, nooit de volledige poort — die moet vóór de merge alsnog groen zijn.

**Wat je zelf toetst**, want hier is geen script voor:

- [ ] De acceptatiecriteria van de slice staan afgevinkt in het issue, en ze staan
      afgevinkt omdat je het gedrag hébt zien werken — niet omdat de code er staat.
- [ ] Bij elk afgevinkt criterium weet je welke test het bewaakt, en die test zou
      rood worden als het gedrag verdwijnt. Dit is ook wat een review als eerste
      naloopt: niet of de tests groen zijn, maar of ze het criterium toetsen.
- [ ] De actie is bereikbaar in natuurlijke taal (zie _Natuurlijke taal_), of de
      refinement legt onder _Wat het expliciet níet doet_ uit waarom niet.
- [ ] Nieuw gedrag zit achter een flag die uit staat in productie, en je weet
      wanneer die flag weer weg mag (zie _Feature flags_).
- [ ] Verandert het datamodel: de migratie is gegenereerd met `pnpm db:generate`,
      en er is een terugweg. Dit is de enige stap in de hele pijplijn die
      `promote <vorige tag>` níet terugdraait, dus splits een verandering in
      toevoegen-en-vullen nu, en het oude veld weghalen in een latere release —
      pas als niets het meer leest.
- [ ] Kan het nieuwe gedrag falen, dan kun je achteraf zien dát het gebeurde: een
      logregel op het punt waar de beslissing valt, met het id dat het inkomende
      bericht of verzoek meedraagt. Een fout die alleen als stilte zichtbaar is,
      kost op productie een veelvoud.
- [ ] Wijkt het gedrag af van wat de documentatie van de app belooft, dan is die
      documentatie mee bijgewerkt.
- [ ] Til je de factory naar een nieuwe versie, dan heb je `factory sync` gedraaid
      en het resultaat meegecommit. Een bump zonder sync laat de slash commands en
      de skill achterlopen, en de sync-drift-stap in CI zet je poort rood — vaak in
      elke app tegelijk.
- [ ] Je hebt het zelf gedaan op een omgeving waar het écht draait — acc na
      `promote acc`, of prod. "CI was groen" is geen waarneming.

**Wanneer het issue dicht gaat.** Afvinken doe je tijdens het bouwen; de kolom
**Done** en het sluiten van het issue horen bij de laatste stap van de pijplijn, als de
laatste slice op productie draait en je hem daar gezien hebt. Een gesloten issue
betekent "het werkt", niet "het is gemerged".
