---
id: test-coverage
titel: Inzicht in test coverage per applicatie
status: idee
aangemaakt: 2026-07-30
---

# Inzicht in test coverage per applicatie

## Wat wil ik?

In de beheer-tool zien hoe goed elke applicatie getest is: de coverage van de
verschillende testsoorten (unit, contract, e2e) per applicatie, in één overzicht.

## Waarom?

De kwaliteitspoort (`factory verify`) draait wel tests, maar zegt alleen "groen
of rood". Ik zie nergens in één blik hoeveel van de code echt gedekt is, of dat
per applicatie vergelijken. Als er meer applicaties bijkomen wil ik snel kunnen
zien waar de dekking dun is, zonder per repo een coverage-run te starten en logs
te lezen.

## Hoe zie ik het voor me?

```
Beheer — test coverage

  applicatie   unit    contract   e2e     totaal
  assistant    87%     100%       72%     84%
  beheer       ...     ...        ...     ...

(per applicatie de dekking per testsoort; klikken toont detail per bestand?)
```

Dit is een vierde functie onder [[beheer-console]], naast health-overzicht,
flag-beheer en log-niveau.

## Wat weet ik nog niet?

- **Waar komt de coverage vandaan?** `factory verify` draait de tests nu zonder
  coverage te verzamelen. Vitest kan coverage produceren (er is al een
  `coverage/`-map die genegeerd wordt in git). Moet `verify` optioneel coverage
  gaan schrijven, of draait de beheer-tool zelf een coverage-run per applicatie?
- **Per testsoort of samengevoegd?** Unit, contract en e2e hebben elk een eigen
  vitest-config. Tonen we ze los (zoals hierboven) of één totaalcijfer?
- **Hoe vers?** Coverage is een momentopname van de laatste run. Tonen we het
  laatst bekende cijfer, of kun je vanuit de tool een run starten? Een run starten
  raakt aan "acties vanuit de beheer-tool", wat we daar voorlopig buiten houden.
- **Hoeveel detail?** Eerst waarschijnlijk alleen percentages per applicatie en
  testsoort; later eventueel inzoomen tot per-bestand.
- **Hoe vindt de tool de applicaties en hun coverage-output?** Zelfde vraag als
  bij health-overzicht: de tool moet de applicaties kennen (via hun `factory.json`)
  en weten waar hun coverage-rapport staat.
- **Drempels?** Willen we een ondergrens per applicatie waaronder het rood kleurt,
  of alleen tonen zonder oordeel?

## Grofweg hoe groot?

Middel. Het tonen is klein; het echte werk zit in het betrouwbaar verzamelen van
coverage per applicatie en per testsoort, en in de vraag of `verify` daar iets
voor moet gaan leveren.
