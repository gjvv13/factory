---
name: functioneel-grilling
description: >-
  Het frontier-algoritme voor functionele uitwerking. Gebruik deze skill bij
  `/functioneel`, `/refine` vanaf Idee, onbemand refine-werk en elke chat die
  functionele vereisten uitwerkt. Trigger op het uitwerken van functionele
  vragen, het vaststellen van productbesluiten, en op vragen als "wat willen we",
  "waar ligt de grens" of "wat doet het expliciet niet".
---

# Functioneel grilling — frontier-patroon

Grilling is een interviewtechniek: jij formuleert de vragen met aanbevelingen
(auteur), de gebruiker bevestigt of wijkt af (redacteur). Elk functioneel besluit
komt van de gebruiker — nooit van jou. Het frontier-patroon structureert dat
interview.

## Het frontier-algoritme

1. **Bouw de frontier.** Identificeer alle openstaande vragen waarvan de
   voorwaarden (eerdere besluiten) vervuld zijn. Een vraag zonder open
   voorwaarde is per definitie in de frontier.
2. **Presenteer de frontier.** Toon álle vragen tegelijk — niet beperkt tot een
   maximum per ronde. Elke vraag heeft:
   - Een nummer.
   - De vraag: bondig, in één of twee zinnen.
   - De aanbevolen keuze, met een korte onderbouwing (waarom je dit adviseert).
3. **Wacht op antwoorden.** Ga niet verder tot de gebruiker geantwoord heeft.
4. **Verwerk de antwoorden.** Registreer elk besluit.
5. **Herbereken de frontier.** De beantwoorde vragen zijn weg; hun antwoorden
   kunnen nieuwe vragen ontgrendelen. Ga terug naar stap 1.
6. **Klaar als de frontier leeg is.** Er zijn geen onbesliste vragen meer.

Een lege frontier bij de eerste ronde (er valt niets te beslissen, of het issue
bevat al alle benodigde besluiten) is geldig: sla het interview over en ga
direct verder met de volgende stap.

## Feiten vs. besluiten

- **Feiten** — wat staat er in de code, welke API levert wat, hoe werkt het nu —
  zoek je zelf op. Gebruik tools, lees bestanden, draai sub-agents als het moet.
  Stel hier geen vragen over; dat kost rondes en de gebruiker weet het antwoord
  niet beter dan jij.
- **Besluiten** — wat willen we, waar ligt de grens, wat doet het niet — zijn
  altijd van de gebruiker. Jij doet een aanbeveling, nooit een keuze.

## Twee modi

### Attended — `/functioneel`, `/refine` vanaf Idee

De vragen gaan de chat in; de gebruiker antwoordt inline. Het transport is de
chat zelf — er verandert niets aan het mechanisme.

Rondevolgorde:

1. Bouw de eerste frontier.
2. Presenteer de vragen als genummerde lijst met aanbevelingen.
3. Wacht op de antwoorden van de gebruiker.
4. Verwerk, herbereken, en presenteer de volgende frontier — of sluit af.

### Onbemand — refine-werker

De refine-werker verzint nooit zelf functionele besluiten. Komt hij een
functionele vraag tegen die niet beantwoord is:

1. Bouw de frontier (alle onbeantwoorde vragen met vervulde voorwaarden).
2. Formuleer de vragen in frontier-formaat: genummerd, elk met aanbevolen
   keuze en onderbouwing.
3. Escaleer via het bestaande mechanisme (`uitkomst: "escalatie"`, `vraag` +
   `advies`). De frontier is de inhoud van de escalatie.
4. De gebruiker beantwoordt async via `factory orkestreer antwoord`.

Het escalatie-mechanisme verandert niet — alleen het formaat van de inhoud.

## Het besluiten-blok

Een afgeronde grill (alle vragen beantwoord, frontier leeg) schrijft een sectie
naar de issue-body:

```markdown
## Functionele besluiten (BINDEND — met <wie>, <datum>)

1. **<Onderwerp>.** <Keuze ondubbelzinnig geformuleerd.>
2. **<Onderwerp>.** <Keuze ondubbelzinnig geformuleerd.>
```

- `<wie>`: "gebruiker" in de attended modus, of de naam/rol als die bekend is.
- `<datum>`: de datum van de afrondende ronde (formaat: YYYY-MM-DD).
- Elk besluit is genummerd en noemt de keuze zonder dubbelzinnigheid.
- Dit blok volstaat voor de gate: `heeftFunctioneleSecties` in `orkestreer.ts`
  en `gate-refine.sh` accepteren `## Functionele besluiten`.

## CONTEXT.md-onderhoud

Na elke afgeronde grill onderhoud je `CONTEXT.md` in de repo-root van de app.

1. **Lees bij aanvang.** Als `CONTEXT.md` bestaat, lees het — het bevat het
   glossarium, de invarianten en de open vragen van deze applicatie.
2. **Werk bij na afronding.** Loop de besluiten langs:
   - Nieuwe termen die in de besluiten voorkomen → voeg toe aan **Glossarium**.
   - Besluiten die een invariant vastleggen → voeg toe aan **Invarianten** met
     verwijzing naar het issuenummer.
   - Functionele vragen die niet in deze grill beantwoord zijn → voeg toe aan
     **Open vragen**.
3. **Maak aan als het niet bestaat.** Gebruik het format met drie koppen
   (Glossarium, Invarianten, Open vragen) uit de conventie.
4. **Houd het dun.** Geen proza, geen duplicatie van de issue-body. Eén regel per
   term, één bullet per invariant. CONTEXT.md is een index, geen document.

Het besluiten-blok staat naast de bestaande functionele secties (`Gedrag`,
`Natuurlijke taal`, `Regels en randgevallen`, `Wat het expliciet níet doet`) —
het vervangt ze niet. De secties beschrijven het ontwerp; het blok registreert
de keuzes die eraan ten grondslag liggen.
