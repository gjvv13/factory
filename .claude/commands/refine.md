---
description: Werk een backlog-idee (GitHub Issue) uit tot architectuur en slices
---

Refine dit backlog-item: $ARGUMENTS (formaat: `<issuenummer>`)

De backlog is één set GitHub Issues in `gjvv13/factory`; zie `WORKFLOW.md`.

Doe dit zo:

1. Lees het issue: `gh issue view <nummer> -R gjvv13/factory`. Bepaal uit het
   `app:`-label welke applicatie het betreft. Lees `templates/refinement.md`. De
   coding-guidelines-skill (`skills/coding-guidelines/SKILL.md`) beschrijft de
   lagen waarin je de technische architectuur straks indeelt; houd die aan.
2. Verken de code van de applicatie voordat je iets ontwerpt. Die staat naast deze
   repo, in `../<app>/`. Kijk vooral naar `app/src/app.ts` (hier wordt alles
   samengeknoopt), `app/src/core/commands.ts`, `app/src/db/schema.ts` en
   `app/src/core/command-router.ts`. Hergebruik wat er is; stel niets nieuws voor
   waar al iets voor bestaat.
3. Bepaal de functionele architectuur: welk gedrag komt erbij, welke randgevallen,
   en wat het expliciet niet doet.
4. Bepaal de technische architectuur per laag, inclusief datamodel, migratie,
   externe koppelingen (met contract) en feature flag.
5. Knip het op in slices. Een slice is zelfstandig af: werkt, is getest, kan naar
   productie. Twee tot vier slices is normaal; is één slice genoeg, zeg dat dan.
6. Leg keuzes waar je twijfelt aan mij voor met concrete opties en jouw advies.
   Verzin geen aannames over wat ik wil.
7. Schrijf de uitwerking volgens de template naar een tijdelijk bestand en werk
   het issue bij: `gh issue edit <nummer> -R gjvv13/factory --body-file <tijdelijk bestand> --add-label "status:refined" --remove-label "status:idea"`.
8. Sluit af met de slices op één regel per stuk, en zeg dat de volgende stap is:
   `cd ../<app>` en daar `/bouw <nummer> 1`.

Schrijf nog geen applicatiecode.
