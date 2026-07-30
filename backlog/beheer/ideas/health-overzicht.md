---
id: health-overzicht
titel: Overzichtspagina met de health van alle applicaties
status: idee
aangemaakt: 2026-07-30
---

# Overzichtspagina met de health van alle applicaties

## Wat wil ik?

Eén pagina die in één oogopslag de health toont van alle applicaties én hun
omgevingen (dev, acc, prod): draait het, welke versie, welk kanaal, en is het
gezond?

## Waarom?

Nu moet ik per omgeving `factory env status` (pm2) draaien of handmatig een
`/health` opvragen om te zien wat er draait. Met één applicatie is dat te doen,
maar zodra er meer bijkomen wordt het rommelig. Een overzicht geeft direct rust:
ik zie in één blik of alles leeft en op welke versie, zonder commando's.

## Hoe zie ik het voor me?

```
Factory — health

  applicatie   omgeving   status    versie   kanaal     uptime
  assistant    dev        ● ok      0.1.4    http       2u
  assistant    acc        ● ok      0.1.2    http       2u
  assistant    prod       ● ok      0.1.4    whatsapp   6m
  ...          ...        ...       ...      ...        ...

(elke rij komt uit het /health-endpoint van die omgeving)
```

## Wat weet ik nog niet?

- **Waar draait deze pagina?** De factory is nu een CLI zonder web-UI. Wordt dit
  een klein lokaal servertje dat je start (`factory dashboard`?), of iets dat
  altijd meedraait? De pagina zelf pollt de `/health`-endpoints van de omgevingen.
- **Hoe kent het overzicht de applicaties en omgevingen?** Elke applicatie heeft
  een `factory.json` met naam en poorten, naast de factory-repo. Hoe vindt de
  factory die applicaties — een register, of een afgesproken map? Nu weet de
  factory alleen van de app waarin je staat.
- **Poorten en paden:** elke omgeving draait op een eigen poort (uit
  `factory.json`); health opvragen is die poorten op localhost pollen.
- **Alleen lezen of ook acties?** Waarschijnlijk eerst alleen-lezen (tonen). Later
  eventueel herstarten of promoten vanaf de pagina — maar dat raakt aan
  onomkeerbare acties en hoort niet in een eerste versie.
- **Beveiliging:** net als de admin-routes van de applicaties: loopback-only.
- **Verhouding tot `factory env status`:** vervangt dit dat commando, of vult het
  aan met een visueel overzicht?

## Grofweg hoe groot?

Middel. De `/health`-endpoints bestaan al, maar de factory heeft nog geen web-UI;
het meeste werk zit in het ontdekken van de applicaties/omgevingen en een klein
servertje dat de pagina levert. Dit is de app-overstijgende kant van het beheer;
`flag-beheer` en `log-niveau` (zelfde backlog) bedienen juist één applicatie van
binnenuit. Samen vallen ze onder `beheer-console`.
