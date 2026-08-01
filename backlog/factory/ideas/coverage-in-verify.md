---
id: coverage-in-verify
titel: Coverage laten verzamelen door factory verify
status: idee
aangemaakt: 2026-08-01
---

# Coverage laten verzamelen door factory verify

## Wat wil ik?

`factory verify` de testdekking laten meten en rapporteren, zodat "dekking" een
meetbaar getal wordt in plaats van alleen groen/rood.

## Waarom?

Geen enkel project meet nu coverage; de kwaliteitspoort zegt alleen of de tests
slagen. Daardoor is niet te zien of een test-suite van 73 cases veel of weinig
dekt, en kun je niet sturen op waar de dekking dun is. Dit is de factory-kant
van [[test-coverage]] (het beheer-idee om dekking per app te tónen): daar staat
al genoteerd dat `verify` de tests nu zonder coverage draait. Vitest kan
coverage produceren; er is al een genegeerde `coverage/`-map.

## Hoe zie ik het voor me?

- De vitest-presets een coverage-optie geven (bijv. `verify --coverage` of altijd
  in CI).
- Een samenvatting per testsoort (unit/contract/e2e) wegschrijven op een vaste
  plek, zodat de beheer-tool het kan oppikken ([[test-coverage]]).
- Eventueel een ondergrens per app waaronder de poort rood wordt.

## Wat weet ik nog niet?

- Coverage altijd draaien (langzamer) of alleen op verzoek/in CI?
- Per testsoort apart of één totaalcijfer? De drie soorten hebben eigen configs.
- Waar schrijven we het rapport zodat beheer het betrouwbaar vindt (samenhang met
  `factory.json`)?

## Grofweg hoe groot?

Middel (dagdeel).
