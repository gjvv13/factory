---
id: cli-commando-tests
titel: Tests voor de factory-CLI-commando's
status: idee
aangemaakt: 2026-08-01
---

# Tests voor de factory-CLI-commando's

## Wat wil ik?

De gevaarlijkste code van de factory — de commando's die deployen, releasen en
in andere repo's schrijven — onder test krijgen. Nu is vrijwel alleen
`app-config.ts` getest.

## Waarom?

`test/app-config.test.ts` (11 cases) dekt alleen pure helpers. `promote.ts`,
`release.ts`, `nieuw.ts` en `sync.ts` hebben nul tests, terwijl juist die code
prod kan slopen: `promote` shelt naar `git clean`, `pm2 delete/start` en
migraties; `release` tagt en pusht; `nieuw` kopieert bomen, alloceert poorten en
vervangt tokens; `sync` schrijft in app-repo's. Het meest risicovolle deel is
het minst getest. Het degelijke testfundament zit in het skeleton, dus
gegenereerde apps starten goed — maar de generator zelf is nauwelijks bewaakt.

## Hoe zie ik het voor me?

- De shell-laag (`src/shell.ts`) afvangbaar maken zodat commando's getest kunnen
  worden zonder echt te deployen (nagaan welke git/pnpm/pm2-calls ze doen).
- Per commando de belangrijke gevallen: `nieuw` (tokenvervanging, poortallocatie,
  botsende poorten), `sync` (wat wordt gekopieerd), `promote`/`release` (juiste
  volgorde, afbreken bij fout).
- Minimaal de foutpaden: wat doet een commando als een stap faalt?

## Wat weet ik nog niet?

- Hoeveel kunnen we met unit-tests op een geabstraheerde shell afvangen, en waar
  hebben we een integratietest nodig (bijv. `nieuw` echt in een temp-map draaien)?
- Sluit dit aan op [[coverage-in-verify]] — willen we een dekkingsdrempel op de
  factory zelf?

## Grofweg hoe groot?

Groot — moet opgesplitst worden, per commando.
