# Fastlane-baan voor de nachtbouw

## Context

De nachtbouw levert PR's af die 's ochtends op review wachten. Voor losstaande
bugs en kleine tasks is die review-stap een bottleneck: het werk is laag-risico
(geen child-slices, geen epics, geen migraties), de poort is al groen, en het
wachten voegt geen zekerheid toe.

De vraag: mag de nachtbouw zulk werk vanzelf mergen, zodat de ochtend begint met
een inbox van wat er gedaan is in plaats van een rij PR's om goed te keuren?

## Beslissing

**Optie B: auto-merge op groen voor fastlane-items.** Een fastlane-PR merget
zichzelf zodra CI (`verify`) en de dekkings-ratchet groen zijn, zonder
ochtend-akkoord. Dit is een **bewuste, afgebakende afwijking** van het principe
dat code pas landt na een mensbesluit.

### Drie randvoorwaarden maken de afwijking verantwoord

1. **Groene poort.** `verify` (opmaak, lint, types, unit, contract, e2e, build)
   én de dekkings-ratchet moeten slagen. Zakt iets, dan blijft de PR open en
   verschijnt hij 's ochtends als uitzondering.

2. **Ochtendmelding.** Na de nacht-lus stuurt de supervisor één POST naar
   `DEPLOY_NOTIFY_URL` met per auto-gemergde PR: issuenummer, app, PR-URL. Geen
   merge → geen melding (geen ruis). URL niet gezet → waarschuwing, geen fout.
   De melding maakt het werk zichtbaar zonder dat je het board hoeft te openen.

3. **Alleen losstaande items.** Child-slices (sub-issues van een epic) zijn
   uitgesloten: die horen in de geordende gewone baan, waar de volgorde ertoe
   doet. Alleen `type:bug` (automatisch) en `type:task` met het `fastlane`-label
   (expliciet gezet door een mens) komen in aanmerking.

### Expliciete guard

De refiner kan geen labels zetten (`src/werker.ts:28`): het `fastlane`-label
wordt alleen door een mens gezet, niet door een onbemande werker. Dat voorkomt
dat een refinement-run zichzelf in de fastlane plaatst.

### Prerequisites per repo

- **"Allow auto-merge"** moet aan staan in de repo-instellingen.
- Branch protection / ruleset met verplichte `verify`-check (bestaat al op de
  factory-repo).

## Alternatieven

### Optie A: review blijft, fastlane als snelle triageband

De fastlane selecteert en bouwt dezelfde items, maar levert in met
`--geen-automerge`: de PR's wachten op een mens. De winst is triage (losstaande
bugs eerst, epics apart), niet automatisch mergen.

**Waarom afgevallen:** de review-bottleneck voor laag-risico werk blijft bestaan.
De poort (groene CI + ratchet) is al de strengste gate die we hebben; een extra
menselijke stap voegt voor dit soort items geen zekerheid toe die de poort niet
al levert.

**Terugvaloptie:** als de drie randvoorwaarden niet genoeg blijken, is optie A de
terugweg: verander de `--fastlane`-vlag in `--geen-automerge` bij het inleveren
en de ochtendmelding wordt een reviewlijst. Het mechanisme blijft hetzelfde.

## Verwijzingen

- **Datum:** 2026-08-26
- **Issue:** #401
- **Epic:** #397
- **Bron:** CLAUDE.md § "De onbemande werker" (`--soort bouw`); ADR 007
  (bouw-nacht); issue #397 § "Functionele kaders"
