---
description: Bouw één slice uit een gerefined backlog-item (GitHub Issue)
---

Bouw deze slice: $ARGUMENTS (formaat: `<issuenummer> <slicenummer>`)

Dit bestand wordt beheerd door de factory. Wijzig het daar en haal het hier op
met `factory sync`.

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md` daar.

Doe dit zo:

1. Lees het gerefinede item: `gh issue view <issuenummer> -R gjvv13/factory`. Pak
   alleen de genoemde slice. Bouw niets uit een andere slice, ook niet "omdat het
   er toch bijna is".
2. De `coding-guidelines`-skill laadt hier vanzelf; houd je aan de lagen en de
   afhankelijkheidsrichting die hij beschrijft.
3. Maak een branch: `git checkout -b slice/<issuenummer>-<nummer>`.
4. Bouw de slice. Zet nieuw gedrag achter de feature flag uit de refinement, en
   voeg die flag toe aan `app/test/fixtures/feature-flags.json` (uit voor productie,
   aan voor tests als de tests hem nodig hebben).
5. Verandert het datamodel, genereer dan de migratie met `pnpm db:generate` —
   schrijf migratie-SQL nooit met de hand.
6. Schrijf de tests uit de slice: unit voor de logica, contract bij een nieuwe
   externe koppeling, e2e voor het gedrag dat ik als gebruiker merk. Nieuwe
   testdata gaat in `app/test/fixtures/`.
7. Draai `pnpm verify` tot alles groen is. Rood betekent niet af.
8. Commit in kleine stappen. Vink de acceptatiecriteria van deze slice af in het
   issue zodra ze aantoonbaar werken (in de GitHub-UI of met `gh issue edit`). Is
   dit de laatste slice, zet dan het label `status:refined` → `status:done` en sluit
   het issue.
9. Sluit af met: wat werkt er nu, hoe kan ik het zelf proberen (concreet commando
   of bericht), en wat de volgende stap is.

Merge niet naar main en release niet zonder dat ik dat vraag.
