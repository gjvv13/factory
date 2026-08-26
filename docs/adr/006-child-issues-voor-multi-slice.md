# Sub-issues als model voor meerdere slices

## Context

Een issue met meer dan één slice werd te vroeg gesloten: `factory afronden` zag
de eerste slice-branch in een release en verplaatste het hele issue naar Done,
terwijl er nog slices openstonden. Daarnaast kon de bouw-nacht een multi-slice
issue niet slice-voor-slice afwerken, omdat de kolom aan het issue hing en niet
aan de individuele slice.

## Beslissing

Multi-slice-werk wordt altijd gesplitst in **child-issues** (sub-issues). Eén
issue = één slice; een epic bundelt de slices. Elk kind is zelfstandig bouwbaar
én afsluitbaar, dus `factory afronden` sluit nooit iets te vroeg en de bouw-nacht
kan een epic slice-voor-slice afwerken.

De refine-werker levert de slice-opdeling als voorstel terug; bij het akkoord
splitst de mens (of `factory splits`) dat in child-issues onder een epic. De
refiner krijgt geen issue-aanmaakrechten.

## Alternatieven

- **Multi-slice in één issue met slice-tracking:** vereist een apart veld of
  label per slice en maakt de board-automatiek complexer — de kolom zou aan
  een sub-entiteit binnen het issue moeten hangen, wat GitHub Projects niet
  ondersteunt.
- **`afronden` slim maken (tellen hoeveel slices er zijn):** fragiel — het
  aantal slices is een vrij-tekstveld in het issue, niet een gestructureerde
  relatie. De branchnaam (`slice/<issue>-<n>`) vertelt welke branch bij welk
  issue hoort, maar niet hoeveel er in totaal zijn.

## Verwijzingen

- **Datum:** 2026-08-24
- **Issue:** #348
- **Bron:** WORKFLOW.md § "Epics en slices: ouder en kind"; issue #348 §
  "Functionele architectuur"
