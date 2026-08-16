# Werkwijze: één backlog in GitHub Issues

De backlog van álle applicaties leeft als **GitHub Issues in `gjvv13/factory`** —
één plek, over de repo's heen. Dit bestand is de bron van waarheid voor het proces
en geldt voor elke applicatie in het ecosysteem.

## Waarom hier

De factory is de gedeelde, centrale repo (elke app haalt hem als devDependency
binnen). Grooming hoort centraal; bouwen hoort in de applicatie. Door de backlog
in de factory-issues te zetten, blijft er één overzicht terwijl elke app zijn eigen
code-repo houdt.

## Applicatie: het App-veld

Bij welke applicatie een issue hoort, staat in het **`App`-veld** van het board —
een aparte kolom, geen label. De opties zijn `assistant`, `beheer`, `factory`; een
nieuwe app krijgt zijn optie automatisch van `factory nieuw`. Zo blijft de
Labels-kolom schoon en groepeer je het board in één oogopslag per applicatie.

## Labels

Naast het App-veld draagt elk issue twee soorten labels:

- **`status:<fase>`** — waar het in de pijplijn zit: `status:idea` (ruw),
  `status:refined` (uitgewerkt, klaar om te bouwen), `status:done` (afgerond).
- **`type:<soort>`** — wat voor werk het is: `type:epic` (grote, meerdere-slices
  functionaliteit), `type:task` (klus, chore, kleine verbetering), `type:bug` (defect).

### Epics vs. klein werk — twee lagen

De grote brokken (`type:epic`) hoef je niet dagelijks te zien; die volg je op het
board. Je **dagelijkse werk-lijst** is een gefilterde issue-weergave zónder epics:

- Bugs + klusjes (geen epics): `is:issue is:open -label:type:epic`
- Alleen bugs: `is:issue is:open label:type:bug`
- Alleen de epics: `is:issue is:open label:type:epic`

### Eerst zoeken, dan aanmaken

Voordat je een nieuw issue aanmaakt, controleer je of het al bestaat — open óf
gesloten: `gh issue list -R gjvv13/factory --search "<kernwoorden>" --state all`.
Bestaat het al, vul dan dat issue aan in plaats van een duplicaat te maken. Zo
blijft de backlog één-op-één met het werk.

### Beslissingen horen in de epic, niet op de lijst

Een nog-te-nemen beslissing wordt **geen los issue**. Zet 'm als een
"Open beslissingen"-regel (checklist) in de body van de epic waar hij bij hoort. Zo
blijft de issue-lijst schoon en staat de keuze bij het onderwerp.

## Board

Eén board bundelt alles: **"Backlog — alle applicaties"**
(https://github.com/users/gjvv13/projects/2). Groepeer of filter op het `App`-veld
voor één applicatie, `status:` voor een fase, of `type:` voor epics vs. klein werk.

## De pijplijn

| Stap          | Commando                 | Waar             | Wat er met het issue gebeurt                                          |
| ------------- | ------------------------ | ---------------- | --------------------------------------------------------------------- |
| 1. Idee       | `/idee <beschrijving>`   | factory          | Nieuw issue, `App`-veld gezet + labels `type:<soort>` + `status:idea` |
| 2. Refinement | `/refine <issue#>`       | factory          | Body uitgewerkt; label `status:idea` → `status:refined`               |
| 3. Bouwen     | `/bouw <issue#> <slice>` | in de applicatie | Slice bouwen; acceptatiecriteria afvinken in het issue                |
| 4. Testen     | `pnpm verify`            | in de applicatie | —                                                                     |
| 5. Releasen   | `pnpm release`           | in de applicatie | —                                                                     |
| 6. Promoveren | `pnpm promote`           | in de applicatie | Bij afronding: `status:refined` → `status:done`, issue sluiten        |

`/status` geeft het overzicht via het board (per `App`-veld en `status:`).

Aftikken hoort aan het eind, niet bij de merge: de acceptatiecriteria vink je af
tijdens het bouwen (stap 3), maar `status:done` en het sluiten van het issue horen
bij stap 6 — als de laatste slice op productie draait en je hem daar gezien hebt.
Wat "af" verder inhoudt, staat als één lijst onder _Klaar_ in de
[`coding-guidelines`-skill](skills/coding-guidelines/SKILL.md).

## Als de pijplijn hapert

Loopt er iets mis tussen "mijn code is af" en "het draait op prod" — verify/CI,
`inleveren`, de integratie-wachtrij, `release`, `promote`, `deploy.yml`, de
migratie-gate, env/secrets, de runners of de dekkings-ratchet — dan maak je daar
**een issue voor in deze backlog**: App-veld `factory`, label `type:bug`. Ook als
je een workaround vond; dan is het een bug mét bekende oplossing.

Dit geldt vanuit **elke** app-chat, ook al ben je daar met een andere applicatie
bezig. Zo'n storing raakt alle apps maar valt buiten de app waar je toevallig mee
bezig bent — zonder deze afspraak verdwijnt hij in een chat-log.

Niet bedoeld voor je eigen falende test of typefout: die repareer je gewoon.

Zet in de body de letterlijke foutmelding, de aanleiding (welke app, welke
versie), de workaround, en of andere apps het ook raken. Groomen mag vanuit de
app-chat; bouwen hoort in de factory-chat.

## Grooming vs. bouwen

Groomen (idee, refine) doe je in factory; bouwen doe je in de applicatie-repo.
Omdat alle issues in `gjvv13/factory` staan, werkt `/bouw` vanuit elke app met
`gh issue view <nummer> -R gjvv13/factory`.

## Gereedschap

Alles loopt via de `gh` CLI (ingelogd als `gjvv13`). Issues worden met
`--body-file` en de labels hierboven aangemaakt en bijgewerkt.
