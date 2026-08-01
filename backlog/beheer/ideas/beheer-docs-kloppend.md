---
id: beheer-docs-kloppend
titel: CLAUDE.md en coding-skill beschrijven de verkeerde app
status: idee
aangemaakt: 2026-08-01
---

# CLAUDE.md en coding-skill beschrijven de verkeerde app

## Wat wil ik?

De documentatie van beheer moet beheer beschrijven, niet assistant. De sectie
"De applicatie" in `CLAUDE.md` is nu woordelijk uit assistant gekopieerd.

## Waarom?

`CLAUDE.md` (regels 41-64) praat over een kanaalonafhankelijke kern,
`InboundMessage`, `MessageService`, `CommandRouter`, een `channels/`-map en
commando's `help/ping/hallo/versie`, met een curl naar `/channels/http/inbound`.
Niets daarvan bestaat in beheer: er zijn geen kanalen, geen commando's, geen
message-service. De echte routes zijn `/`, `/api/overview`, `/admin/flags` en
`/api/apps/:app/:omgeving/flags`. De `coding-guidelines`-skill heeft dezelfde
mismatch: die stuurt naar `channels/ → core/ → db/` met een message-service.

Dit is doc-rot die Claude Code (en een mens) actief het verkeerde model
ingeeft. Het is ook het levende bewijs dat kopiëren tussen apps drift oplevert —
zie het bredere idee [[sync-drift-check]].

## Hoe zie ik het voor me?

- De sectie "De applicatie" in `beheer/CLAUDE.md` herschrijven naar wat beheer
  echt is: een health-aggregator + remote flag-beheer, met de echte lagen
  (`core/` ports, `clients/` HTTP-invulling, `http/` routes + console-page).
- Nagaan of de per-app `coding-guidelines`-skill generiek genoeg gemaakt kan
  worden dat hij voor beide apps klopt, of dat hij per app moet verschillen.

## Wat weet ik nog niet?

- Hoort dit generiek opgelost te worden in de factory (skeleton levert een
  kloppende CLAUDE.md-template per app), of is dit een eenmalige handmatige fix?
- Kan de coding-skill één bron blijven, of moeten apps zonder kanalen/commando's
  een andere variant krijgen?

## Grofweg hoe groot?

Klein (uurtje) als eenmalige fix; middel als we het structureel in de factory
oplossen.
