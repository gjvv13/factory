---
id: berichtlog-retentie
titel: Retentie en maskering voor het berichtenlog (PII)
status: idee
aangemaakt: 2026-08-01
---

# Retentie en maskering voor het berichtenlog (PII)

## Wat wil ik?

Niet onbeperkt de volledige tekst van echte WhatsApp-berichten in platte tekst
bewaren. Er moet een bewuste keuze zijn over wat we opslaan, hoe lang, en of het
gemaskeerd wordt.

## Waarom?

`message_log` slaat de volledige `text` van alle in- en uitgaande berichten op
(`app/src/db/schema.ts`, `app/src/core/message-log.ts`), plus `logs/*.log`
groeit mee. Voor echte gesprekken is dat PII in een onversleutelde SQLite en in
platte logs, zonder retentie- of maskeerbeleid. Alles is gitignored dus er lekt
niets naar de repo, maar het is wel een gegevensbeschermingspunt dat we bewust
willen afwegen in plaats van per ongeluk laten ontstaan.

## Hoe zie ik het voor me?

- Een retentietermijn: berichten ouder dan X automatisch opschonen.
- Overwegen of de bericht-`text` gemaskeerd of weggelaten kan worden waar we hem
  niet nodig hebben (bijvoorbeeld alleen metadata loggen).
- Log-niveau op prod al op `warn`; controleren dat berichtinhoud niet alsnog in
  de logs belandt.

## Wat weet ik nog niet?

- Waarvoor hebben we de volledige tekst echt nodig (debuggen, audit), en hoe lang?
- Retentie in de applicatie zelf (opschoontaak) of iets op omgevingsniveau?
- Willen we versleuteling op de database, of is retentie + toegangsbeperking
  (nu al loopback + pm2 op 127.0.0.1) voldoende?

## Grofweg hoe groot?

Middel (dagdeel). Het opschonen is klein; de afweging over wat we bewaren en
maskeren is het echte werk.
