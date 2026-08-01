---
id: readme-per-repo
titel: README per repo en factory-docs die beheer kennen
status: idee
aangemaakt: 2026-08-01
---

# README per repo en factory-docs die beheer kennen

## Wat wil ik?

Elke repo een echte `README.md` geven voor een mens, en de factory-docs
bijwerken zodat ze de werkelijkheid beschrijven (beheer bestaat inmiddels).

## Waarom?

Geen van de drie repos heeft een `README.md`; `CLAUDE.md` doet nu dienst als
readme. Prima voor Claude, maar ongebruikelijk — zeker omdat de factory een
publieke repo is. Onboarden zonder de zusterrepo erbij is lastig. Daarnaast
noemt het diagram in `factory/CLAUDE.md` (regels 6-10) alleen `factory/` +
`assistant/`; `beheer` wordt nergens genoemd terwijl die repo actief is met een
eigen backlog en releases. De docs lopen achter op de realiteit.

## Hoe zie ik het voor me?

- Een korte `README.md` per repo: wat is dit, hoe start je het, waar staat de
  rest (verwijzing naar de factory voor pipeline/guidelines).
- Het skeleton een README-template geven, zodat een nieuwe app er meteen mee
  begint.
- `factory/CLAUDE.md` bijwerken: beheer opnemen in het diagram en waar relevant.

## Wat weet ik nog niet?

- Willen we de README's grotendeels laten genereren uit `factory.json` (naam,
  poorten) zodat ze niet weer uit de pas gaan lopen?
- Hoeveel dubbelt een README met CLAUDE.md, en wat is de taakverdeling (mens vs
  Claude)?

## Grofweg hoe groot?

Klein tot middel (uurtje per repo; de skeleton-template is het meeste werk).
