---
description: Werk een backlog-idee uit tot architectuur en slices
---

Refine dit backlog-item: $ARGUMENTS (formaat: `<app> <id>`, of alleen `<id>` als er één applicatie is)

Doe dit zo:

1. Lees `backlog/<app>/ideas/<id>.md` en `templates/refinement.md`. De
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
7. Schrijf `backlog/<app>/refined/<id>.md` volgens de template en verwijder het
   bestand uit `backlog/<app>/ideas/`.
8. Sluit af met de slices op één regel per stuk, en zeg dat de volgende stap is:
   `cd ../<app>` en daar `/bouw <id> 1`.

Schrijf nog geen applicatiecode.
