---
id: ci-comment-en-pins
titel: Stale CI-comment en bleeding-edge toolchain-pins
status: idee
aangemaakt: 2026-08-01
---

# Stale CI-comment en bleeding-edge toolchain-pins

## Wat wil ik?

De verouderde comment in de CI opruimen en de risicovolle toolchain-pins
bewust maken en documenteren.

## Waarom?

`workflows/ci.yml` (regel ~17) praat over "node24" terwijl `.nvmrc` op `22`
staat — een comment die niet meer klopt. Losser hangt de factory aan
bleeding-edge versies: eslint `^10`, typescript-eslint `^8.65`, TypeScript hard
op `6.0.3` (peer `>=6 <7`), `@types/node ^26`, vitest `^4`. TS is vastgepind
omdat typescript-eslint TS 7 nog niet ondersteunt. Omdat élke app de factory via
een git-tag binnenhaalt, kan één lockfile-bump de self-hosting build breken en
daarmee alle downstream-apps. De reden van de pin staat wel in CLAUDE.md, maar
het risico verdient een expliciete plek.

## Hoe zie ik het voor me?

- De node24-comment in `ci.yml` corrigeren of verwijderen.
- Kort documenteren welke pins bewust zijn en waarom, en wanneer we ze mogen
  optrekken (bijv. "TS 7 pas als typescript-eslint het ondersteunt").
- Eventueel een lichte bewaking: laat weten wanneer een pin veilig verhoogd kan
  worden.

## Wat weet ik nog niet?

- Willen we conservatiever pinnen (minder bleeding-edge) om de keten stabieler te
  maken, of bewust vooroplopen?

## Grofweg hoe groot?

Klein (uurtje).
