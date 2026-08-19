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
8. Schrijf de uitwerking weg. **Meer dan één slice? Dan wordt elke slice een
   sub-issue** — dat is wat een slice bouwbaar maakt zonder dat iemand eerst een body
   moet lezen (#127).
   - **Bij één slice:** één issue, zoals altijd. Geen kind, geen extra ruis.
     `gh issue edit <nummer> -R gjvv13/factory --body-file <tijdelijk bestand>`
   - **Bij meer slices:** de ouder houdt samenvatting, functionele en technische
     architectuur, risico's en besluiten. Per slice maak je een kind met de doel-,
     acceptatiecriteria-, tests-, testdata- en flag-secties — dáár wordt op gebouwd.
     ```bash
     URL=$(gh issue create -R gjvv13/factory --title "<prefix> · <slicetitel>" \
       --body-file <slicebestand> --label "type:task")
     DBID=$(gh api repos/gjvv13/factory/issues/${URL##*/} --jq .id)
     gh api -X POST repos/gjvv13/factory/issues/<ouder>/sub_issues -F sub_issue_id=$DBID
     ITEM=$(gh project item-add 2 --owner gjvv13 --url "$URL" --format json | jq -r .id)
     ```
     `<prefix>` is het deel vóór `·` in de titel van de ouder, of anders de naam van
     de applicatie met een hoofdletter. Zet op elk kind hetzelfde `App`-veld als de
     ouder en de kolom waar de ouder stond, en **wis daarna de kolom van de ouder**:
     er wordt nooit aan een epic gewerkt, alleen aan een slice. De voortgang van de
     ouder leest af aan `Sub-issues progress`.
   - Zet daarna de kolom die bij jouw ingang hoort — op de kinderen als die er zijn,
     anders op het issue zelf:
     - vanaf **Idee**: `Klaar voor Bouwen`
     - vanaf **Klaar voor technische refinement**: laat ze op **Technisch refinen**
       staan. Verplaats niets door naar Klaar voor Bouwen — dat is het akkoord van de
       gebruiker, niet van jou, en die geeft het per slice.
9. Sluit af met de slices op één regel per stuk — mét hun issuenummers als je
   kinderen hebt gemaakt — en zeg wat de volgende stap is:
   - vanaf **Idee**: `cd ../<app>` en daar `/bouw <nummer>`.
   - vanaf **Klaar voor technische refinement**: het wacht op mijn akkoord — bouwen
     kan zodra ik een slice naar **Klaar voor Bouwen** verplaats.

Schrijf nog geen applicatiecode.
