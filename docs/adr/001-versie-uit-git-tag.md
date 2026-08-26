# Versie afleiden uit de nieuwste git-tag

## Context

`factory release` moet het volgende versienummer bepalen. De voor de hand liggende
bron is `package.json` op `main`, maar dat loopt achter na een automatische release:
`release.yml` zet de tag direct en werkt `package.json` bij via een auto-merge-PR
die nog niet gemerged hoeft te zijn op het moment dat de volgende release draait.

## Beslissing

De volgende versie wordt afgeleid uit de **nieuwste git-tag**, niet uit
`package.json`. De tag is de bron van waarheid voor wat er in productie staat; het
`version`-veld in `package.json` is een afgeleide die via een apart PR wordt
bijgewerkt.

## Alternatieven

- **`package.json` als bron:** eenvoudiger, maar loopt achter zodra de
  auto-merge-PR nog niet gemerged is. Dit leidde tot dubbele tags of een verkeerde
  versie bij snelle opeenvolgende releases.
- **Een apart versiebestand of changelog:** meer onderhoud zonder voordeel, want de
  tag is al de canonieke versie die de apps oppikken.

## Verwijzingen

- **Datum:** 2026-06-01
- **Issue:** #132
- **Bron:** CLAUDE.md § "Een applicatie koppelen" — "de volgende versie afleidt van
  de nieuwste git-tag (niet van `package.json` op main, dat kan achterlopen)"
