---
description: Leg in gesprek vast wát een backlog-item moet doen, vóór er techniek bij komt
---

Werk dit backlog-item functioneel uit: $ARGUMENTS (formaat: `<issuenummer>`)

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md`.

**Waarom deze stap apart staat.** Wat er gevraagd wordt weet alleen ik; hoe het
gebouwd wordt volgt uit de code. Die knip is de reden dat de technische uitwerking
straks onbemand kan: een werker mag uitvoeren, maar nooit bepalen wat we willen.
Alles wat een productbeslissing is — welke acties een vrije-taal-ingang krijgen
(#59), wat het bewust níet doet, waar de grens ligt — hoort hier, niet daar.

Doe dit zo:

1. Lees het issue: `gh issue view <nummer> -R gjvv13/factory`. Het moet in de kolom
   **Idee** of **Functioneel uitwerken** staan; staat het verder, meld dat dan en
   stop. De kolom en de applicatie zijn velden op het board, geen labels; vind het
   item met `gh project item-list 2 --owner gjvv13 --format json --limit 200` en lees
   daar `status` en `app` van dit issuenummer. Lees `templates/refinement.md`.
2. Verken de code van de applicatie (`../<app>/`) — maar alleen zo ver als nodig om
   goede vragen te stellen en te weten wat er al is. Ontwerp hier nog niets.
3. **Toets de premisse van het issue tegen de code.** Klopt wat het issue beweert —
   bestaande namen, routes, gedrag, "de huidige praktijk is X" — nog met wat je in de
   code ziet? Wijkt het af, meld de discrepantie dan met bewijs (bestand/regel) en
   vraag om richting vóór je verder gaat. Een backlog-item kan verouderd zijn.
4. Stel de vragen die je nodig hebt, maar niet meer dan drie per ronde, en alleen
   als het antwoord echt niet uit het issue volgt. Vraag naar wat ik wil, niet naar
   hoe het gebouwd moet worden — dat is de volgende stap.
5. Vul **alleen de functionele secties** uit de template: `Samenvatting`, en onder
   `Functionele architectuur` de secties `Gedrag`, `Natuurlijke taal`,
   `Regels en randgevallen` en `Wat het expliciet níet doet`. Laat de technische
   koppen weg; die schrijft `/refine` erbij. Zet `status: functioneel` in de
   frontmatter.
   - `Natuurlijke taal` is hier geen bijzaak: welke acties in vrije taal bereikbaar
     zijn, is een productbeslissing. Standaard **alle** — zie het brein-patroon in de
     `coding-guidelines`-skill. Wijk je daarvan af, motiveer dat dan onder
     _Wat het expliciet níet doet_.
   - `Wat het expliciet níet doet` mag niet leeg blijven. Grenzen zijn hier het punt.
6. Schrijf de tekst naar een tijdelijk bestand en werk het issue bij, en zet daarna
   de kolom op **Klaar voor technische refinement** — daar wacht het op een werker:
   `gh issue edit <nummer> -R gjvv13/factory --body-file <tijdelijk bestand>`
   `gh project item-edit 2 --owner gjvv13 --url <issue-url> --field Status --value "Klaar voor technische refinement"`
7. Vat in twee regels samen wat er nu vastligt en wat je bewust hebt opengelaten.
   Volgende stap: `/refine <nummer>` werkt de technische helft uit — met de hand, of
   onbemand zodra de orkestrator draait.

Ontwerp geen techniek en schrijf geen code. Kies geen modules, tabellen, routes of
slices: dat is precies wat je hier openlaat.
