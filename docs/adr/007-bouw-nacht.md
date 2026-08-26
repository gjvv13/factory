# Onbemand bouwen 's nachts

## Context

De orkestrator had al een nachtmodus voor technische refinements (`--nacht` om
04:00). Bouwen — code schrijven, testen, de poort draaien — is een volgende
stap in dezelfde pijplijn, maar met meer rechten (schrijven i.p.v. alleen
lezen) en een hoger budget per item.

## Beslissing

De bouw-werker krijgt een eigen `--nacht`-modus en een eigen LaunchAgent, los
van de refine-nacht. Kenmerken:

- **Dagmaximum 2** (configureerbaar via `FACTORY_BOUW_DAGMAXIMUM`), lager dan
  de refine-nacht (4) — bouwen is duurder en het werk moet 's ochtends
  reviewbaar zijn.
- **Tijdstip 05:30**, ná de refine-nacht (04:00), zodat ze niet overlappen.
- **Eén gedeeld slot** (`factory-orkestreer.lock`): twee werkers tegelijk is
  het probleem, ongeacht de soort. Slot bezet → overslaan.
- **Auto-merge blijft uit** (`--geen-automerge`): de PR's staan 's ochtends
  open voor review.
- **Eigen teller** (`nachtBouw`), los van de refine-teller, zodat het
  dagmaximum per soort geldt.

## Alternatieven

- **Eén gecombineerde nachtrun (refine + bouw):** eenvoudiger, maar de budgetten
  en dagmaxima lopen uiteen — een refinement kost ~$0.80, een bouw ~$5–10. Een
  gezamenlijk maximum zou óf te weinig refinements óf te veel bouw-runs toelaten.
- **Bouwen overdag, handmatig:** geen schaalvoordeel; de nacht is vrije
  rekentijd.
- **Parallel bouwen:** gevaarlijk — twee werkers in dezelfde repo botsen op
  bestanden, en het slot is er juist om dat te voorkomen.

## Verwijzingen

- **Datum:** 2026-08-24
- **Issue:** #343
- **Bron:** CLAUDE.md § "De onbemande werker" (`--soort bouw --nacht`);
  issue #343 § "Functionele architectuur"
