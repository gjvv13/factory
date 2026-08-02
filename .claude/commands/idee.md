---
description: Zet een nieuw idee op de backlog (GitHub Issue) van een applicatie
---

Zet het volgende idee op de backlog: $ARGUMENTS

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md`.

Doe dit zo:

1. Bepaal voor welke applicatie het idee is. De applicatie is geen label meer maar
   het **App-veld** (een kolom) op het board. Kijk met
   `gh project field-list 2 --owner gjvv13 --format json` welke App-opties er zijn
   (het veld heet `App`) en vraag het als er meer dan één in aanmerking komt.
2. **Bestaat dit al?** Zoek eerst met `gh issue list -R gjvv13/factory --search
"<kernwoorden>" --state all` of er al een issue (open óf gesloten) over gaat.
   Zo ja: geen nieuw issue, maar vul dat bestaande aan of meld het en stop.
3. **Is dit eigenlijk een nog-te-nemen beslissing?** Zet die dan NIET als los issue
   neer. Zoek de epic waar hij bij hoort (`gh issue list -R gjvv13/factory --label
type:epic`) en voeg de beslissing toe als een "Open beslissingen"-regel in de body
   van die epic (`gh issue edit <epic#> -R gjvv13/factory --body-file …`). Klaar. Zie
   WORKFLOW.md → "Beslissingen horen in de epic".
4. Bepaal het **type**: `type:epic` (grote, meerdere-slices functionaliteit),
   `type:task` (klus, chore, kleine verbetering) of `type:bug` (defect). Twijfel je
   tussen epic en task, leg de keuze kort voor.
5. Lees `templates/idea.md` voor de vorm van de omschrijving.
6. Stel de vragen die je nodig hebt om de template te vullen — maar niet meer dan
   drie, en alleen als het antwoord echt niet uit het idee volgt. Een backlog-item
   mag onvolledig zijn; dat is waar de refinement voor is.
7. Schrijf de omschrijving volgens de template naar een tijdelijk bestand, in het
   Nederlands, met de datum van vandaag. Maak dan het issue aan — mét de `type:`- en
   `status:`-labels, maar **zonder** een `app:`-label (de applicatie is nu een veld):
   `URL=$(gh issue create -R gjvv13/factory --title "<titel>" --body-file <tijdelijk bestand> --label "type:<soort>" --label "status:idea")`
   Zet daarna de applicatie via het App-veld op het board. Haal eenmalig de ids op met
   `gh project view 2 --owner gjvv13 --format json` (`.id` = project-id) en
   `gh project field-list 2 --owner gjvv13 --format json` (het veld `App` geeft het
   field-id en per optie een `id`), en doe dan:
   `ITEM=$(gh project item-add 2 --owner gjvv13 --url "$URL" --format json | jq -r .id)`
   `gh project item-edit --id "$ITEM" --project-id <project-id> --field-id <App-field-id> --single-select-option-id <optie-id van de gekozen applicatie>`
8. Vat in twee regels samen wat er nu op de backlog staat, noem het issuenummer én
   het type. Volgende stap: een `type:epic` gaat via `/refine <issuenummer>`; een
   duidelijke `type:task` of `type:bug` mag direct naar `/bouw` in de applicatie.

Bouw nog niets. Dit is alleen vastleggen.
