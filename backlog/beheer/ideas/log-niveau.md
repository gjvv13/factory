---
id: log-niveau
titel: Log-niveau aanpassen via een pagina
status: idee
aangemaakt: 2026-07-30
---

# Log-niveau aanpassen via een pagina

## Wat wil ik?

Het log-niveau van een omgeving zien en aanpassen via een pagina, zonder het
env-bestand te bewerken en de omgeving te herstarten.

## Waarom?

Nu is `LOG_LEVEL` een opstart-variabele. Wil ik tijdelijk op `info` of `debug`
zetten — bijvoorbeeld om mee te kijken tijdens debuggen of tijdens het koppelen
van een kanaal — dan moet ik de secrets aanpassen én herstarten, en achteraf weer
terug. Dat is precies één keer te vaak gebeurd. Een pagina maakt het een kwestie
van kiezen, live, en weer terugzetten als ik klaar ben.

## Hoe zie ik het voor me?

```
Log-niveau — prod

  huidig: warn

  [ trace  debug  info  warn  error  fatal  silent ]
            → kies een niveau; verandering is direct actief
```

## Wat weet ik nog niet?

- **Runtime i.p.v. opstart:** het log-niveau komt nu uit de omgevingsvariabele en
  wordt bij het opstarten gelezen (`config.ts`, de logger, en de Fastify-logger).
  Dit idee vraagt om het live aanpasbaar maken (pino's `logger.level` en de
  request-logger tijdens het draaien omzetten). Dat is de kern van het werk.
- **Persistentie:** onthoudt de omgeving de gekozen stand over een herstart heen
  (net als de feature flags in de database), of val ik bij herstart terug op de
  waarde uit het env-bestand? Waarschijnlijk terugvallen, zodat de env de bron
  van waarheid blijft en een tijdelijke verhoging vanzelf verdwijnt.
- **Samenhang met [[flag-beheer]]:** dit is opnieuw een beheerpagina op de
  loopback-only admin-routes. Waarschijnlijk hoort het op dezelfde pagina als het
  flag-beheer, niet op een losse. Beveiliging speelt hier hetzelfde.
- **Welke niveaus:** alle pino-niveaus toestaan, of alleen een handige subset?

## Grofweg hoe groot?

Klein tot middel. Het meeste werk zit niet in de pagina maar in het log-niveau
tijdens het draaien kunnen omzetten; de pagina eromheen is klein en deelt
vermoedelijk de opzet met `flag-beheer`.
