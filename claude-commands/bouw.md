---
description: Bouw één slice uit een gerefined backlog-item (GitHub Issue)
---

Bouw dit item: $ARGUMENTS (formaat: `<issuenummer>`)

Dit bestand wordt beheerd door de factory. Wijzig het daar en haal het hier op
met `factory sync`.

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md` daar.

Doe dit zo:

1. Lees het item: `gh issue view <issuenummer> -R gjvv13/factory`. Bij een epic met
   meer slices is elke slice een eigen sub-issue (#127) — bouw je dus altijd op het
   **kind**, en het nummer dat je meekrijgt is dat van het kind. Bouw niets uit een
   ander issue, ook niet "omdat het er toch bijna is".
2. **Controleer eerst of er niet al aan deze slice gewerkt wordt** — er lopen soms
   parallelle sessies, en die mogen elkaars werk niet overschrijven:
   - **Is het issue nog te bouwen?** `gh issue view <issuenummer> -R gjvv13/factory
--json state` — is het gesloten, dan is de slice waarschijnlijk al af. Kijk ook naar
     de kolom op het board (`gh project item-list 2 --owner gjvv13 --format json
--limit 200`, veld `status`): staat het op **Done** of **Uitrollen**, stop en
     meld het. Staat het op **Bouwen**, dan werkt er mogelijk al iemand aan. Staat het
     nog vóór **Klaar voor Bouwen** — op **Technisch refinen** of eerder — dan is het
     nog niet goedgekeurd: stop en meld het, ook als de refinement er compleet uitziet.
   - **Bestaat er al een slice-branch?** In de repo waar je bouwt:
     `git branch --list 'slice/<issuenummer>-*'` én
     `git ls-remote --heads origin 'slice/<issuenummer>-*'`.
   - **Is er al een open PR voor dit issue?** `gh pr list --state open --search
'<issuenummer>'` (in de huidige repo).

   Vind je een van deze signalen, **stop en stem af**: bouw niet door op dezelfde
   slice. Meld concreet wat je vond (branch, PR of status) en vraag of je moet
   aanhaken, wachten of overnemen.

3. De `coding-guidelines`-skill laadt hier vanzelf; houd je aan de lagen en de
   afhankelijkheidsrichting die hij beschrijft.
4. Maak een branch: `git switch -c slice/<issuenummer>-1` (of
   `git checkout -b …`).
5. Bouw de slice. Zet nieuw gedrag achter de feature flag uit de refinement, en
   voeg die flag toe aan `app/test/fixtures/feature-flags.json` (uit voor productie,
   aan voor tests als de tests hem nodig hebben).
6. Verandert het datamodel, genereer dan de migratie met `pnpm db:generate` —
   schrijf migratie-SQL nooit met de hand.
7. Schrijf de tests uit de slice: unit voor de logica, contract bij een nieuwe
   externe koppeling, e2e voor het gedrag dat ik als gebruiker merk. Nieuwe
   testdata gaat in `app/test/fixtures/`.
8. Draai `pnpm verify` tot alles groen is, en loop daarna de _Klaar_-lijst uit de
   `coding-guidelines`-skill langs. Rood is niet af, maar groen alleen ook niet.
   Draai daarna `/code-review` met deze opdracht erbij: **toets of de tests de
   acceptatiecriteria van de slice bewaken** — per criterium welke test het dekt, en of
   die test rood zou worden als het gedrag verdwijnt. Groen zegt alleen dat de tests
   kloppen met de code; dit zegt of ze kloppen met wat er gevraagd was.
9. Commit in kleine stappen. Vink de acceptatiecriteria van deze slice af in het
   issue zodra je het gedrag hebt zien werken (in de GitHub-UI of met
   `gh issue edit`). Zet de kolom op **Bouwen** zolang je bezig bent, en sluit het
   issue niet: **Done** komt pas als de laatste slice op productie draait — stap 8 van
   de pijplijn in `WORKFLOW.md`.
10. Sluit af met: wat werkt er nu, hoe kan ik het zelf proberen (concreet commando
    of bericht), en wat de volgende stap is.

Merge niet naar main en release niet zonder dat ik dat vraag.
