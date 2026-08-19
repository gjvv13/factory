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

## Staat: de kolom op het board

Waar een item in de pijplijn staat, is **de kolom op het board** — het veld
`Status`. Dat is de bron van waarheid; er bestaat geen `status:`-label meer.

| Kolom                     | Betekent                                                         | Wie is aan zet          |
| ------------------------- | ---------------------------------------------------------------- | ----------------------- |
| **Idee**                  | Ruw vastgelegd, nog niet uitgewerkt                              | —                       |
| **Functioneel uitwerken** | Staat klaar voor het gesprek over wát er gevraagd wordt          | jij, via `/functioneel` |
| **Technisch refinen**     | Functioneel vast; wacht op een werker, en daarna op jouw akkoord | werker, dan jij         |
| **Bouwen**                | Door jou akkoord bevonden, klaar om gebouwd te worden            | de bouwer               |
| **In aanbouw**            | Er wordt nu aan gebouwd                                          | de bouwer               |
| **Uitrollen**             | Ingeleverd, onderweg naar acc en prod                            | machinaal               |
| **Done**                  | Draait op prod, gezien                                           | —                       |

Zetten doe je met één regel, zonder GraphQL-ids:

```bash
gh project item-edit 2 --owner gjvv13 --url <issue-url> --field Status --value "Bouwen"
```

Uitlezen gaat met `gh project item-list 2 --owner gjvv13 --format json`; elk item
heeft daarin `.status` en `.app`.

**Eén plek, niet twee.** De kolom is de enige plek waar de staat staat. Zet er geen
label naast dat hetzelfde zegt — dan drijven ze uit elkaar, en dat is precies wat
deze opzet verving.

## Labels

Naast het App-veld en de kolom draagt elk issue twee soorten labels:

- **`escalatie`** — een werker is gestopt met een vraag, of zijn run mislukte. Het
  issue wacht op een antwoord en wordt niet opnieuw opgepakt.
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
voor één applicatie, op `Status` voor een fase, of op `type:` voor epics vs. klein
werk. Groepeer je op `Status`, dan is het board een kanban van de pijplijn hierboven.

## De pijplijn

| Stap           | Commando                 | Waar             | Wat er met het issue gebeurt                                           |
| -------------- | ------------------------ | ---------------- | ---------------------------------------------------------------------- |
| 1. Idee        | `/idee <beschrijving>`   | factory          | Nieuw issue, `App`-veld gezet + label `type:<soort>`; kolom **Idee**   |
| 2. Functioneel | `/functioneel <issue#>`  | factory          | Wát het moet doen ligt vast; → kolom **Technisch refinen**             |
| 3. Technisch   | `/refine <issue#>`       | factory          | Architectuur en slices; blijft in **Technisch refinen**, nu op akkoord |
| 4. Akkoord     | kolom omzetten           | factory          | **Technisch refinen** → **Bouwen** — alleen jij                        |
| 5. Bouwen      | `/bouw <issue#> <slice>` | in de applicatie | → kolom **In aanbouw**; acceptatiecriteria afvinken in het issue       |
| 6. Testen      | `pnpm verify`            | in de applicatie | —                                                                      |
| 7. Releasen    | `pnpm release`           | in de applicatie | → kolom **Uitrollen**                                                  |
| 8. Promoveren  | `pnpm promote`           | in de applicatie | Bij afronding: → kolom **Done**, issue sluiten                         |

`/status` geeft het overzicht via het board (per `App`-veld en per kolom).

### De knip tussen functioneel en technisch

Stap 2 en 3 zijn bewust gescheiden: **wat er gevraagd wordt weet alleen jij; hoe het
gebouwd wordt volgt uit de code.** De refinement-template heeft die naad al — de
secties onder _Functionele architectuur_ tegenover die onder _Technische
architectuur_ — en `/functioneel` vult alleen de eerste helft.

Die knip is er niet voor de vorm: hij maakt stap 3 uitbesteedbaar aan een onbemande
werker (de orkestrator, #104) zonder dat er ooit een idee ongezien code wordt. **De
kolom is de riem.** Een werker pakt alleen items op uit de kolom die hij mag
behandelen; blijft een item in **Idee** staan, dan gebeurt er niets. En alleen jij
verplaatst naar **Bouwen** — voor een refinement bestaat geen `verify` die hem kan
afkeuren, dus die poort kan alleen bij jou liggen. Dat verplaatsen ís het akkoord.

Voor kleine, duidelijke `type:task`- en `type:bug`-items mag je stap 2 overslaan:
`/refine` op een item uit **Idee** doet beide helften in één keer en eindigt in
**Bouwen**.

Aftikken hoort aan het eind, niet bij de merge: de acceptatiecriteria vink je af
tijdens het bouwen (stap 5), maar de kolom **Done** en het sluiten van het issue horen
bij stap 8 — als de laatste slice op productie draait en je hem daar gezien hebt.
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

Groomen (idee, functioneel, refine) doe je in factory; bouwen doe je in de
applicatie-repo.
Omdat alle issues in `gjvv13/factory` staan, werkt `/bouw` vanuit elke app met
`gh issue view <nummer> -R gjvv13/factory`.

## Gereedschap

Alles loopt via de `gh` CLI (ingelogd als `gjvv13`). Issues worden met
`--body-file` en de labels hierboven aangemaakt en bijgewerkt.
