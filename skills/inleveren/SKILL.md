---
name: inleveren
description: >-
  Het inlevermoment en de definitie van "klaar". Gebruik deze skill bij het
  afronden van werk aan een slice, bij de vraag "is dit af" of "kan dit
  ingeleverd worden", en bij het voorbereiden van een PR. Trigger op het
  afronden van een bouwopdracht, op het draaien van de poort, en op twijfel
  of het werk voldoet aan de definitie van done.
---

# Inleveren

Inleveren is het moment waarop een slice van jouw branch naar de gedeelde
codebase gaat. Het is geen formaliteit — het is de grens tussen "het werkt bij
mij" en "het werkt voor iedereen".

## Wanneer is werk klaar?

De definitie van done staat in de `coding-guidelines`-skill, onder het kopje
**Klaar**. Die checklist is de single source of truth; deze skill dupliceert hem
niet. Loop die lijst door vóór je inlevert.

Samengevat: de poort is groen, elk acceptatiecriterium is afgevinkt met een
test die het bewaakt, en de documentatie klopt met het gedrag.

## Het inleverproces

`factory inleveren` doet vier dingen in volgorde:

1. **Poort draaien** — `factory verify` moet groen zijn. Rood is niet af.
2. **Branch pushen** — je werk gaat naar de remote.
3. **PR openen** — met de slice-beschrijving als body.
4. **In de wachtrij zetten** — de PR krijgt het label `wachtrij` (bij lokale
   integratie) of gaat in de merge-queue (bij de publieke factory-repo).

Als de poort rood is, stopt het proces. Er is geen `--force`.

## Wat er daarna gebeurt

- **Merge**: `factory integreer` (of de merge-queue) werkt de wachtrij serieel
  af — oudste PR eerst, met een CI-check voor elke merge.
- **Deploy**: een merge naar `main` triggert `deploy.yml`, die
  `factory deploy acc` draait (nieuwe release-tag + promote acc). Bevat de
  change een nieuwe migratie, dan stopt het daar; anders rolt prod automatisch
  door.
- **Promote**: `factory promote prod` rolt de tag uit naar productie. Het
  backlog-item gaat naar **Done** zodra prod de tag draait.

## Onbemand inleveren

Een bouw-werker schrijft code maar levert niet zelf in: `git push` en `gh pr`
staan op zijn verbodslijst. Het inleveren doet de supervisor/orkestrator met
`factory inleveren`. Standaard opent dat een PR **zonder** auto-merge — de merge
blijft een mensbesluit. Alleen als het issue het label `auto-merge-ok` draagt
én de code-review-gate schoon is, merget de PR zichzelf achter de groene poort
(#573); zonder dat label blijft de PR-grens bij een mens.
