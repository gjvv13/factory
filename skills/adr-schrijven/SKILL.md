---
name: adr-schrijven
description: >-
  Wanneer en hoe een Architecture Decision Record (ADR) schrijven. Gebruik deze
  skill bij het nemen of bespreken van een richtingbepalende platformkeuze — een
  technologiekeuze, een architectuurpatroon, een procesafspraak — of bij de vraag
  "moet dit een ADR worden". Trigger op het vastleggen van een architectuurbeslissing,
  op het aanmaken van een nieuw ADR-bestand, en op vragen als "waarom is dit zo
  gekozen" als het antwoord nog niet vastligt.
---

# ADR schrijven

Een Architecture Decision Record legt een richtingbepalende platformkeuze vast:
het **waarom** achter een beslissing die je niet meer stilletjes terugdraait. Eén
ADR per beslissing, niet per issue of per feature.

## Wanneer

Bij een keuze die het platform raakt en die je niet meer stilletjes terugdraait:
een technologiekeuze, een architectuurpatroon, een procesafspraak. Niet bij elke
commit of elke bugfix. De drempel is: zou een collega over een half jaar willen
weten waarom dit zo is? Dan is het een ADR.

## Waar

ADR's staan in `docs/adr/` in de factory-repo. Ze zijn onderdeel van de factory
omdat ze platformbeslissingen vastleggen die meerdere applicaties raken.

## Het sjabloon

Kopieer `docs/adr/000-sjabloon.md` naar een nieuw bestand en vul de vier velden
in:

| Veld            | Wat erin staat                                                  |
| --------------- | --------------------------------------------------------------- |
| **Context**     | Welk probleem of welke vraag speelde er? Wat was de aanleiding? |
| **Beslissing**  | Wat is er gekozen en waarom?                                    |
| **Alternatieven** | Welke andere opties zijn overwogen en waarom vielen ze af?     |
| **Verwijzingen** | Datum, issue-nummer, en eventuele links naar bewijsplaatsen    |

## Naamconventie

`NNN-kebab-case-titel.md` — oplopend vanaf 001. Nummer 000 is het sjabloon. Kijk
in `docs/adr/README.md` voor het huidige overzicht en het eerstvolgende vrije
nummer.

## Overzicht

`docs/adr/README.md` bevat de tabel met alle bestaande ADR's. Werk die tabel bij
wanneer je een nieuw ADR toevoegt.
