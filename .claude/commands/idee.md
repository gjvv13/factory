---
description: Zet een nieuw idee op de backlog (GitHub Issue) van een applicatie
---

Zet het volgende idee op de backlog: $ARGUMENTS

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md`.

Doe dit zo:

1. Bepaal voor welke applicatie het idee is. Staat dat niet in de vraag, kijk dan
   met `gh label list -R gjvv13/factory` welke `app:`-labels er zijn en vraag het
   als er meer dan één in aanmerking komt.
2. Lees `templates/idea.md` voor de vorm van de omschrijving.
3. Stel de vragen die je nodig hebt om de template te vullen — maar niet meer dan
   drie, en alleen als het antwoord echt niet uit het idee volgt. Een backlog-item
   mag onvolledig zijn; dat is waar de refinement voor is.
4. Schrijf de omschrijving volgens de template naar een tijdelijk bestand, in het
   Nederlands, met de datum van vandaag. Maak dan het issue aan:
   `gh issue create -R gjvv13/factory --title "<titel>" --body-file <tijdelijk bestand> --label "app:<naam>" --label "status:idea"`
5. Vat in twee regels samen wat er nu op de backlog staat, noem het issuenummer,
   en zeg dat de volgende stap `/refine <issuenummer>` is.

Bouw nog niets. Dit is alleen vastleggen.
