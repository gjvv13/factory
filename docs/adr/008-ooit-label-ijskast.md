# `ooit`-label als ijskast voor uitgestelde items

## Context

Niet elk backlog-item is nu relevant. Sommige ideeën zijn waardevol maar niet
urgent — ze staan in de weg bij het dagelijks werken met de backlog, maar
weggooien is zonde. Er is een mechanisme nodig dat items parkeert zonder ze te
sluiten of te verliezen.

## Beslissing

Het label **`ooit`** werkt als ijskast: een item met dit label is bewust
uitgesteld en wordt niet opgepakt door de orkestrator. Het item blijft open en
doorzoekbaar, maar valt buiten de actieve wachtrij. Weghalen van het label
brengt het terug in de rij.

Het label is bewust geen kolom op het board: een kolom suggereert voortgang en
zou het board visueel vervuilen met items waar niemand aan werkt. Een label is
een filter — het haalt items uit het zicht zonder ze te verbergen.

## Alternatieven

- **Issue sluiten met een "uitgesteld"-reden:** GitHub kent geen reopen-queue;
  een gesloten issue verdwijnt uit het standaardzicht en wordt vergeten.
- **Een aparte kolom "IJskast" op het board:** maakt het board breder zonder
  nut — niemand scrolt naar die kolom, en het board is voor actief werk.
- **Een milestone "Later":** milestones zijn bedoeld voor tijdgebonden
  doelen, niet voor een oneindige parkeerplaats.

## Verwijzingen

- **Datum:** 2026-08-24
- **Issue:** —
- **Bron:** `gh issue list --label ooit` (de items die het label dragen)
