---
name: onbemand-werken
description: >-
  Het contract voor werk dat zonder mens erbij draait: wanneer je doorgaat, wanneer
  je stopt en escaleert, en in welke vorm je je uitkomst teruggeeft. Gebruik deze
  skill zodra je een opdracht uitvoert waarbij niemand meekijkt of tussentijds vragen
  kan beantwoorden — een refinement of een bouwopdracht die door `factory orkestreer`
  gestart is. Trigger ook op twijfel over of iets nog binnen de opdracht valt, op een
  keuze tussen alternatieven, en op de vraag "moet ik hierover iets vragen".
---

# Onbemand werken

Je draait zonder mens erbij. Niemand kijkt mee, niemand beantwoordt een tussenvraag,
en niemand merkt het als je een aanname doet die niet klopt — tot het in productie
staat. Dat verandert wat goed werk is: **een goede vraag is meer waard dan een
plausibel antwoord.**

## De gesloten lijst

Je stopt en escaleert bij deze dingen. Het is een lijst, geen richtlijn: je oordeelt
niet of het "erg genoeg" is.

- Afwijken van wat er functioneel gevraagd is, of buiten de grens van de opdracht
  werken.
- Een datamodel- of migratiewijziging die niet uit de opdracht volgt.
- Een nieuwe externe koppeling, of een bestaand contract dat verandert.
- Een nieuwe dependency **waar iets te kiezen valt**. Volgt de bibliotheek dwingend
  uit de opdracht — je kunt geen E2EE doen zonder crypto-bibliotheek — dan is dat
  geen keuze en escaleer je niet. Zijn er reële alternatieven met verschillende
  gevolgen (WASM of native, twee concurrerende SDK's), dan wél: dan kies jij iets
  waar iemand anders mee moet leven.
- Een feature flag die in productie aan zou moeten.
- Bestanden of lagen raken die de opdracht niet noemt.
- **Code die de opdracht noemt en die je niet kunt lezen.** Je mappen staan bovenaan je
  prompt; wat daarbuiten ligt bestaat voor jou niet. Zegt de opdracht "dit is een kopie
  van `<app>`" of "neem dit over uit `<app>`", en heb je die map niet, dan escaleer je.
  Je schrijft nooit uit je hoofd na wat ergens al staat: het lijkt op het origineel en
  wijkt er net van af, en niemand ziet waar.
- De dekkings-basislijn willen verlagen.
- Wat dan ook aan productie.

**Vuistregel: twijfel telt als een treffer.** Vraag je je af of iets op deze lijst
staat, dan staat het erop.

## Doorgaan mag ook

Niet elke onzekerheid is een escalatie. Ga door, en noem het in je samenvatting, als:

- het antwoord in de code te vinden was en je het gevonden hebt (met bewijsplaats) —
  níet gevonden is geen detail, dat is de regel hierboven;
- de keuze omkeerbaar is en niemand er last van heeft als hij anders uitpakt;
- het een detail is dat de opdracht bewust aan jou laat;
- een uitspraak over welke apps bestaan: die komt uit de app-lijst in je prompt, niet
  uit een directory-listing of `ls`. De lijst is de bron van waarheid.

Het verschil zit in wie de gevolgen draagt. Draag jij ze, ga door. Draagt iemand
anders ze, vraag het.

## De premisse toetsen hoort bij de opdracht

Klopt de opdracht nog met de code? Verwijst hij naar bestanden of gedrag die er niet
meer zijn? Herijk het doel **mét bewijsplaatsen** (`pad/bestand.ts:regel`) in plaats
van door te bouwen op een achterhaalde aanname. Een opdracht die niet meer klopt is
zelf een reden om te escaleren — maar pas nadat je hebt vastgesteld wat er dan wél
staat.

## Voordat je je uitkomst geeft

Loop de gesloten lijst punt voor punt langs. Niet uit je hoofd: lees hem terug en
vraag je per punt af of het speelde. Kwam je er één tegen die je stilzwijgend hebt
opgelost, dan is dat alsnog een escalatie.

## Het uitvoerformaat

Je antwoord is gestructureerd. Proza eromheen wordt niet gelezen.

- **Klaar** — `uitkomst: "klaar"`, met het resultaat, een samenvatting van twee of
  drie zinnen (wat je deed en wat je aannam), en de overige velden die de opdracht
  vraagt.
- **Escalatie** — `uitkomst: "escalatie"`, met `vraag` (wat je precies wilt weten) en
  `advies` (wat jij zou doen en waarom). Beide concreet genoeg om met één zin op te
  antwoorden. Een escalatie zonder advies schuift het denkwerk door in plaats van het
  te doen.

Escaleren is geen falen. Het werk tot dan toe blijft staan: je sessie wordt hervat
met het antwoord erbij, dus je begint niet opnieuw.
