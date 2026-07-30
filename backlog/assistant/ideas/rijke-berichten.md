---
id: rijke-berichten
titel: Rijke inhoud via WhatsApp
status: idee
aangemaakt: 2026-07-30
---

# Rijke inhoud via WhatsApp

## Wat wil ik?

Niet alleen tekst, maar ook foto's, audio, video, bestanden, locaties en
kalenderverzoeken via WhatsApp kunnen aanleveren, zodat de applicatie daar iets
mee kan doen.

## Waarom?

Tekst alleen dekt maar een deel van wat ik onderweg wil doorgeven. Een foto van
een bonnetje, een spraakmemo, een locatie of een afspraak zijn precies de dingen
die ik in het moment via WhatsApp deel. Zonder deze inhoud blijft het kanaal een
commandoregel en gebruik ik het niet voor het echte werk.

## Hoe zie ik het voor me?

```
ik:      [foto van een bonnetje]
factory: Bon ontvangen. Wil je hem als uitgave vastleggen?

ik:      [spraakmemo]
factory: Genoteerd — ik heb je bericht als tekst bewaard.

ik:      [locatie]
factory: Locatie ontvangen.
```

Precies welke inhoud welke actie oplevert, hoort bij de refinement en later bij
de losse functies. Deze slice gaat eerst om het kúnnen ontvangen, bewaren en
herkennen van het type inhoud.

## Wat weet ik nog niet?

- Bouwt voort op `whatsapp-kanaal` (tekst werkt daar end-to-end); dit is de
  volgende laag. Het datamodel kent nu alleen `text` — hoe leggen we andere
  inhoudstypes vast, en waar bewaren we de bijlagen zelf (op schijf, buiten git)?
- Welke inhoudstypes eerst? Vermoedelijk foto en spraakmemo als eerste, de rest
  daarna. Elk type is waarschijnlijk een eigen slice.
- Hoe groot mogen bijlagen zijn, en wat doen we bij een te groot of onbekend
  bestand?
- Wat is de generieke afhandeling (ontvangen + bewaren + bevestigen) versus de
  specifieke actie per type (bon → uitgave, kalenderverzoek → afspraak)? Die
  acties zijn eigen functies, niet dit idee.
- Hoe testen we dit zonder echte WhatsApp-media, gegeven dat alleen prod koppelt?

## Grofweg hoe groot?

Groot — moet opgesplitst worden. Vermoedelijk: eerst generiek ontvangen en
bewaren van bijlagen met type-herkenning, dan per inhoudstype de afhandeling.
