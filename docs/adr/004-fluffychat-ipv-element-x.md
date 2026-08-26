# FluffyChat als Matrix-client i.p.v. Element X

## Context

De assistent (Donna) is bereikbaar via Matrix: een Conduit-homeserver op de Mac
mini, van buitenaf ontsloten via een Cloudflare-tunnel. De mensen in het gezin
hebben een client-app op hun telefoon nodig om met `@assistent` te chatten. Het
oorspronkelijke plan was **Element** (Element iOS/Element X) op beide iPhones,
ingelogd op de eigen server.

Twee dingen liepen in de praktijk stuk:

- **Element X werkt niet goed samen met Conduit.** Element X leunt op nieuwere
  Matrix-features (sliding sync) die Conduit niet volledig biedt; het resultaat
  was een client die niet betrouwbaar synchroniseerde tegen deze homeserver.
- **De bot leest geen E2EE** (#51 staat nog open). Nieuwe rooms staan in de
  meeste clients standaard versleuteld, en in een versleutelde room ziet Donna
  de berichten niet. De rooms moeten dus onversleuteld zijn.

## Beslissing

**FluffyChat** is de Matrix-client voor het gezin, niet Element X. FluffyChat
synchroniseert wél betrouwbaar tegen Conduit en is licht genoeg voor dagelijks
gebruik.

Omdat FluffyChat nieuwe rooms standaard versleuteld aanmaakt en de bot geen E2EE
leest, geldt de conventie dat context-rooms **onversleuteld** zijn: die worden
eenmalig onversleuteld aangemaakt (aanvankelijk via Element Web als workaround,
#50), waarna Donna erin kan meelezen. De structurele oplossing — Donna maakt
zelf onversleutelde context-groepen aan — loopt via #50.

## Alternatieven

- **Element X:** het voor de hand liggende, best onderhouden Matrix-client, maar
  synchroniseerde niet betrouwbaar tegen Conduit (sliding-sync-afhankelijkheid).
  Afgevallen op werking, niet op voorkeur.
- **Element Web als dagelijkse client:** werkt wél tegen Conduit en kan
  onversleutelde rooms maken (daarom de workaround voor #50), maar is geen
  prettige telefoon-ervaring voor dagelijks gebruik.
- **De bot E2EE laten lezen (dan maakt de client-keuze niet uit):** dat is #51,
  een substantiële klus. Zolang die niet af is, is een onversleutelde opzet met
  een werkende client de pragmatische weg.

## Verwijzingen

- **Datum:** 2026-08-09
- **Issue:** #34 (Conduit-homeserver), #50 (onversleutelde context-groepen),
  #51 (bot en E2EE)
- **Bron:** issue #34 § opzet ("Element iOS op beide iPhones"); issue #50 §
  "nieuwe rooms in FluffyChat staan standaard versleuteld … geen E2EE, dus je
  moet rooms nu éénmalig via Element Web onversleuteld aanmaken"
