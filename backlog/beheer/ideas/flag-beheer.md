---
id: flag-beheer
titel: Beheerpagina voor feature flags
status: idee
aangemaakt: 2026-07-30
---

# Beheerpagina voor feature flags

## Wat wil ik?

Een simpele webpagina waar ik de feature flags kan zien en aan- of uitzetten,
in plaats van via de CLI (`factory flag`) of een curl naar `/admin/flags`.

## Waarom?

Nu gaat een flag omzetten via de terminal of een handmatige HTTP-call. Dat werkt,
maar het is onhandig als ik snel wil zien wat er aanstaat of iets wil omzetten
zonder terminal bij de hand. Een pagina maakt de staat in één oogopslag duidelijk
en het omzetten een kwestie van één klik — precies wat je wilt als een flag de
schakelaar is tussen "stil testen" en "live".

## Hoe zie ik het voor me?

```
Feature flags — prod

  ping              [aan]  ●———
  whatsapp-channel  [aan]  ●———

(klik op een schakelaar om aan/uit te zetten; verandering is direct actief)
```

De pagina leunt op wat er al is: `GET /admin/flags` levert de lijst,
`PUT /admin/flags/:key` zet er één om. Dit is dus vooral een dunne
frontend-laag bovenop bestaande endpoints.

## Wat weet ik nog niet?

- **Beveiliging:** de admin-routes zijn nu alleen via loopback bereikbaar (de
  server bindt op 127.0.0.1), dus zonder authenticatie. Blijft dat zo, of wil ik
  deze pagina ook van buiten kunnen bereiken — en dan met welke afscherming?
- **Omgevingen:** dev, acc en prod draaien elk op een eigen poort met een eigen
  database. Wil ik één pagina die tussen omgevingen schakelt, of gewoon per
  omgeving z'n eigen pagina op de eigen poort?
- **Omvang van de flag-info:** alleen aan/uit, of ook de beschrijving en wanneer
  hij voor het laatst is omgezet, tonen en bewerken?
- **Vorm:** een kale HTML-pagina die Fastify serveert, of iets uitgebreiders?
  Voor nu vermoedelijk zo simpel mogelijk.

## Grofweg hoe groot?

Klein tot middel — de endpoints bestaan al; het is vooral een pagina eromheen
plus nadenken over of en hoe we hem afschermen.
