---
id: naamgeving-conventie
titel: Naamgevingsconventie vastleggen (Nederlands of Engels)
status: idee
aangemaakt: 2026-08-01
---

# Naamgevingsconventie vastleggen (Nederlands of Engels)

## Wat wil ik?

Eén afspraak over de taal van identifiers, en die toepassen. Nu lopen
Nederlands en Engels door elkaar binnen dezelfde bestanden.

## Waarom?

In assistant staan `berichten`, `kandidaat`, `verwacht`, `leesWhatsAppCloud`
naast `extractTextMessages`, `loadConfig`, `verifyWebhookSignature`; comments en
JSDoc zijn volledig Nederlands. Het werkt, maar een reviewer ziet de
conventie-drift meteen, en het maakt de code minder voorspelbaar. Een vastgelegde
keuze hoort thuis in de coding-guidelines, zodat hij voor alle apps geldt.

## Hoe zie ik het voor me?

- Kiezen: domeintermen en publieke API in het Nederlands (past bij de comments),
  of alles Engels. Waarschijnlijk: Nederlands voor domein/proces, Engels waar we
  een externe API of technische term letterlijk overnemen.
- De keuze opschrijven in de `coding-guidelines`-skill.
- Bestaande afwijkingen geleidelijk meenemen bij aanraken (niet in één grote
  hernoem-actie).

## Wat weet ik nog niet?

- Waar ligt de grens tussen "domeinterm" (NL) en "technische term" (EN)?
- Doen we een eenmalige opschoonronde of alleen vanaf nu?

## Grofweg hoe groot?

De afspraak is klein (uurtje); het consequent toepassen is doorlopend.
