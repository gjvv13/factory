---
description: Werk een backlog-idee (GitHub Issue) uit tot architectuur en slices
---

Refine dit backlog-item: $ARGUMENTS (formaat: `<issuenummer>`)

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md`.

**Twee ingangen.** Kijk eerst naar de kolom van het item op het board; die bepaalt
wat je uitwerkt en waar je eindigt. Lees hem met
`gh project item-list 2 --owner gjvv13 --format json --limit 200` en zoek het
issuenummer op; het veld heet `status`.

| Kolom bij binnenkomst                | Wat je doet                                            | Kolom bij afloop      |
| ------------------------------------ | ------------------------------------------------------ | --------------------- |
| **Idee**                             | de volledige refinement: functioneel én technisch      | **Klaar voor Bouwen** |
| **Klaar voor technische refinement** | alleen de technische helft; het functionele is gegeven | **Technisch refinen** |

Zet het item **meteen bij aanvang** op **Technisch refinen** als je uit de wachtrij
komt. Dat is niet boekhouding: zolang het in de wachtrij staat, mag een tweede werker
het oppakken, en dan doen jullie hetzelfde werk dubbel.

Bij afloop laat je het op **Technisch refinen** staan. Het wacht dan op de goedkeuring
van de gebruiker, en dát akkoord is het verplaatsen naar **Klaar voor Bouwen**. Alleen
de gebruiker doet die stap; verplaats je het zelf, dan verdwijnt de enige poort die een
refinement heeft.

Staat het item in **Technisch refinen**, **Klaar voor Bouwen**, **Bouwen**,
**Uitrollen** of **Done**, meld dat dan en stop: er wordt al aan gewerkt, of het is al
gedaan.

Doe dit zo:

1. Lees het issue: `gh issue view <nummer> -R gjvv13/factory`. Welke applicatie het
   betreft staat in het `App`-veld op het board, niet in een label; vind het item met
   `gh project item-list 2 --owner gjvv13 --format json --limit 100` en lees daar het
   `App`-veld van dit issuenummer. Lees `templates/refinement.md`. De
   coding-guidelines-skill (`skills/coding-guidelines/SKILL.md`) beschrijft de
   lagen waarin je de technische architectuur straks indeelt; houd die aan.
2. Verken de code van de applicatie voordat je iets ontwerpt. Die staat naast deze
   repo, in `../<app>/`. Kijk vooral naar `app/src/app.ts` (hier wordt alles
   samengeknoopt), `app/src/core/commands.ts`, `app/src/db/schema.ts` en
   `app/src/core/command-router.ts`. Hergebruik wat er is; stel niets nieuws voor
   waar al iets voor bestaat.
3. **Toets de premisse van het issue tegen de code.** Klopt wat het issue beweert
   — bestaande namen, routes, gedrag, "de huidige praktijk is X" — nog met wat je
   in de code ziet? Wijkt het af, ontwerp dan niet door op de aanname: meld de
   discrepantie met concreet bewijs (bestand/regel) en vraag de gebruiker om
   richting vóór je verder uitwerkt. Een backlog-item kan verouderd of op een
   verkeerd beeld gebaseerd zijn.
4. De functionele architectuur — hier verschillen de twee ingangen:
   - **Vanaf Idee:** bepaal hem zelf. Welk gedrag komt erbij, welke
     randgevallen, en wat het expliciet niet doet.
   - **Vanaf Technisch refinen:** hij staat er al en hij is van mij. Neem
     `Samenvatting`, `Gedrag`, `Natuurlijke taal`, `Regels en randgevallen` en
     `Wat het expliciet níet doet` **letterlijk** over in de nieuwe body — herschrijf
     ze niet, ook niet om ze strakker te maken. Zie je er een echt probleem in, stel
     de vraag; wijk er niet zelf van af.
5. Bepaal de technische architectuur per laag, inclusief datamodel, migratie,
   externe koppelingen (met contract) en feature flag.
6. Knip het op in slices. Een slice is zelfstandig af: werkt, is getest, kan naar
   productie. Twee tot vier slices is normaal; is één slice genoeg, zeg dat dan.
7. Leg keuzes waar je twijfelt aan mij voor met concrete opties en jouw advies.
   Verzin geen aannames over wat ik wil.
8. Schrijf de uitwerking volgens de template naar een tijdelijk bestand en werk het
   issue bij:
   `gh issue edit <nummer> -R gjvv13/factory --body-file <tijdelijk bestand>`
   Zet daarna de kolom die bij jouw ingang hoort:
   - vanaf **Idee**:
     `gh project item-edit 2 --owner gjvv13 --url <issue-url> --field Status --value "Klaar voor Bouwen"`
   - vanaf **Klaar voor technische refinement**: laat het op **Technisch refinen**
     staan, waar je het bij aanvang al neerzette. Verplaats het **niet** door naar
     Klaar voor Bouwen — dat is het akkoord van de gebruiker, niet van jou.
9. Sluit af met de slices op één regel per stuk, en zeg wat de volgende stap is:
   - vanaf **Idee**: `cd ../<app>` en daar `/bouw <nummer> 1`.
   - vanaf **Klaar voor technische refinement**: het item wacht op mijn akkoord —
     bouwen kan zodra ik het naar **Klaar voor Bouwen** verplaats.

Schrijf nog geen applicatiecode.
