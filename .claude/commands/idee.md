---
description: Zet een nieuw idee op de backlog van een applicatie
---

Zet het volgende idee op de backlog: $ARGUMENTS

Doe dit zo:

1. Bepaal voor welke applicatie het idee is. Staat dat niet in de vraag, kijk dan
   met `ls backlog/` welke applicaties er zijn en vraag het als er meer dan één is.
2. Lees `templates/idea.md`.
3. Bepaal een kort kebab-case id uit de kern van het idee (bijv. `boodschappenlijst`).
   Controleer met `ls backlog/<app>/ideas/` dat het id nog vrij is.
4. Stel de vragen die je nodig hebt om de template te vullen — maar niet meer dan
   drie, en alleen als het antwoord echt niet uit het idee volgt. Een backlog-item
   mag onvolledig zijn; dat is waar de refinement voor is.
5. Schrijf `backlog/<app>/ideas/<id>.md` volgens de template, in het Nederlands,
   met de datum van vandaag.
6. Vat in twee regels samen wat er nu op de backlog staat en zeg dat de volgende
   stap `/refine <app> <id>` is.

Bouw nog niets. Dit is alleen vastleggen.
