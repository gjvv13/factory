# Matrix-client voor het gezin

## Context

De assistent (Donna) is bereikbaar via Matrix: een zelf-gehoste homeserver op de
Mac mini, van buitenaf ontsloten via een Cloudflare-tunnel. De mensen in het
gezin hebben een client-app op hun telefoon nodig om met Donna te chatten. Het
oorspronkelijke plan was **Element** (Element iOS / Element X) op beide iPhones,
ingelogd op de eigen server.

De client-keuze was een tijd lang niet vrij, om twee redenen:

- **De homeserver dwong het af.** In de eerste opzet (Conduit) synchroniseerde
  Element X niet betrouwbaar: het eist de Matrix Authentication Service (OIDC) en
  leunt op sliding sync, en Conduit bood dat niet. Element X gaf "server niet
  ondersteund" — óók bij inloggen, niet alleen registreren. Een lichtere client
  die wél tegen Conduit werkte was daarom destijds de enige begaanbare weg.
- **De bot leest geen E2EE** (#51 staat nog open). Nieuwe rooms staan in de meeste
  clients standaard versleuteld, en in een versleutelde room ziet Donna de
  berichten niet. Context-rooms moeten dus onversleuteld zijn — dat geldt
  ongeacht welke client het gezin gebruikt.

## Beslissing

**Elke gangbare Matrix-client is goed; het gezin mag kiezen.** Sinds de overstap
naar **continuwuity** (2026-08-12, de actieve fork die het uitontwikkelde Conduit
vervangt) is de homeserver-beperking weg: continuwuity heeft een ingebouwde
OAuth2/OIDC-provider én simplified sliding sync — precies de twee eisen die de
eerste opzet niet kon leveren. De gangbare iOS-clients loggen nu betrouwbaar in
en werken even goed voor dagelijks gebruik; dat is end-to-end bevestigd tegen
continuwuity. De client-keuze is daarmee een smaak-, geen werkingsvraag geworden.

De enige harde eis die blijft, staat los van de client: **context-rooms zijn
onversleuteld**, omdat de bot geen E2EE leest. Donna maakt die rooms zelf
onversleuteld aan (#50); de structurele oplossing "bot leest E2EE" is #51.

## Alternatieven

- **Eén client verplicht opleggen:** onnodig sinds continuwuity. De gangbare
  clients werken allemaal; verplichten levert alleen frictie op zonder winst.
- **De bot E2EE laten lezen (dan doet de room-encryptie er niet toe):** dat is
  #51, een substantiële klus. Zolang die niet af is, blijft de onversleutelde
  opzet de pragmatische weg — onafhankelijk van de client-keuze.

## Verwijzingen

- **Datum:** 2026-08-09 (oorspronkelijke keuze), herzien 2026-08-12 (continuwuity)
- **Issue:** #34 (homeserver-opzet), #50 (onversleutelde context-groepen),
  #51 (bot en E2EE)
- **Zie ook:** de bredere Matrix-opzet (continuwuity, tunnel, tokens, de
  E2EE-valkuil) wordt buiten de ADR bijgehouden; deze ADR legt alleen de
  client-keuze vast.
