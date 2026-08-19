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

| Kolom                                | Betekent                                                   | Wie is aan zet          |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------- |
| **Idee**                             | Ruw vastgelegd; wachtrij voor het functionele gesprek      | —                       |
| **Functioneel uitwerken**            | Wordt nu met jou uitgewerkt                                | jij, via `/functioneel` |
| **Klaar voor technische refinement** | Functioneel vast; wachtrij voor de werker                  | —                       |
| **Technisch refinen**                | Een werker werkt het uit; daarna wacht het op jouw akkoord | werker, dan jij         |
| **Klaar voor Bouwen**                | Door jou akkoord bevonden; wachtrij voor de bouwer         | —                       |
| **Bouwen**                           | Er wordt nu aan gebouwd                                    | de bouwer               |
| **Uitrollen**                        | Ingeleverd, onderweg naar acc en prod                      | machinaal               |
| **Done**                             | Draait op prod, gezien                                     | —                       |

De kolommen komen in paren: een **wachtrij** waar niemand aan zet is, en de stap
waarin er gewerkt wordt. Dat onderscheid is niet cosmetisch. Een onbemande werker
moet kunnen zien wélke items hij mag oppakken; zou "wacht op een werker" in dezelfde
kolom staan als "een werker is ermee bezig", dan pakken twee werkers hetzelfde item,
of doet er een een al afgeronde refinement over.

Zetten doe je met één regel, zonder GraphQL-ids:

```bash
gh project item-edit 2 --owner gjvv13 --url <issue-url> --field Status --value "Klaar voor Bouwen"
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

## Epics en slices: ouder en kind

Heeft een refinement meer dan één slice, dan wordt **elke slice een eigen issue**, als
sub-issue van de epic. Dat is niet cosmetisch: de kolom hangt aan het ding waaraan
gewerkt wordt, en dat is een slice, niet een epic.

|                  | Wat erin staat                                                            | Kolom                    |
| ---------------- | ------------------------------------------------------------------------- | ------------------------ |
| **Ouder** (epic) | samenvatting, functionele en technische architectuur, risico's, besluiten | **geen**                 |
| **Kind** (slice) | doel, acceptatiecriteria, tests, testdata, flag                           | de kolom van de pijplijn |

De ouder draagt geen kolomwaarde zodra hij kinderen heeft: er wordt nooit aan een epic
gewerkt. Zijn voortgang staat in het board-veld `Sub-issues progress`, dat zichzelf
bijhoudt. Wil je de epics apart zien, maak dan een tweede board-view gefilterd op
`type:epic`.

De branchnaam blijft `slice/<issuenummer>-<n>`, waarbij het nummer nu dat van het kind
is. Daardoor blijft het automatisch bijwerken van het board (`factory inleveren` en
`factory promote prod`) ongewijzigd werken.

Je akkoord geef je **per slice**: je verplaatst een kind naar **Klaar voor Bouwen**.
Slice 3 mag dus blijven liggen terwijl slice 1 en 2 gebouwd worden.

## De pijplijn

| Stap           | Commando                | Waar             | Wat er met het issue gebeurt                                          |
| -------------- | ----------------------- | ---------------- | --------------------------------------------------------------------- |
| 1. Idee        | `/idee <beschrijving>`  | factory          | Nieuw issue, `App`-veld gezet + label `type:<soort>`; kolom **Idee**  |
| 2. Functioneel | `/functioneel <issue#>` | factory          | Wát het moet doen ligt vast; → **Klaar voor technische refinement**   |
| 3. Technisch   | `/refine <issue#>`      | factory          | Pakt uit die wachtrij, zet **Technisch refinen**, laat het daar staan |
| 4. Akkoord     | kolom omzetten          | factory          | **Technisch refinen** → **Klaar voor Bouwen** — alleen jij            |
| 5. Bouwen      | `/bouw <issue#>`        | in de applicatie | → kolom **Bouwen**; acceptatiecriteria afvinken in het issue          |
| 6. Testen      | `pnpm verify`           | in de applicatie | —                                                                     |
| 7. Releasen    | `pnpm release`          | in de applicatie | → kolom **Uitrollen**                                                 |
| 8. Promoveren  | `pnpm promote`          | in de applicatie | Bij afronding: → kolom **Done**, issue sluiten                        |

`/status` geeft het overzicht via het board (per `App`-veld en per kolom).

### Waar je bouwt: een werkplek per slice

Stap 5 begint met `factory werkplek <issue#>`: een eigen git-worktree naast de repo
(`../<repo>-wt/<issue#>`) op branch `slice/<issue#>-1`, vers van `origin/main`. Bouwen
in de gedeelde werkmap gaat mis zodra er twee sessies lopen — één `.git`, één HEAD, één
`git status`, dus wijzigingen die teruggedraaid worden en bestanden van een ander in je
commit. Met een worktree per slice verdwijnt die hele vraag.

`factory inleveren` ruimt de werkplek zelf op zodra de PR er staat; zit er nog
ongecommit werk in, dan blijft hij staan met een melding. Terugkomen kan altijd:
`factory werkplek <issue#>` hervat dezelfde branch.

Botst je branch met de main van dat moment, dan zegt `inleveren` dat vóór de
kwaliteitspoort draait, met de rebase-stap erbij. Je lost het conflict één keer op en
levert opnieuw in; de poort draait dan over het samengevoegde resultaat.

### De knip tussen functioneel en technisch

Stap 2 en 3 zijn bewust gescheiden: **wat er gevraagd wordt weet alleen jij; hoe het
gebouwd wordt volgt uit de code.** De refinement-template heeft die naad al — de
secties onder _Functionele architectuur_ tegenover die onder _Technische
architectuur_ — en `/functioneel` vult alleen de eerste helft.

Die knip is er niet voor de vorm: hij maakt stap 3 uitbesteedbaar aan een onbemande
werker (de orkestrator, #104) zonder dat er ooit een idee ongezien code wordt. **De
kolom is de riem.** Een werker pakt alleen items op uit de kolom die hij mag
behandelen; blijft een item in **Idee** staan, dan gebeurt er niets. En alleen jij
verplaatst van **Technisch refinen** naar **Klaar voor Bouwen** — voor een refinement
bestaat geen `verify` die hem kan afkeuren, dus die poort kan alleen bij jou liggen.
Dat verplaatsen ís het akkoord.

Voor kleine, duidelijke `type:task`- en `type:bug`-items mag je stap 2 overslaan:
`/refine` op een item uit **Idee** doet beide helften in één keer en eindigt in
**Klaar voor Bouwen** — je bent er dan zelf bij, dus het akkoord is impliciet.

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

### Wat de backlog-repo aan secrets nodig heeft

De pijplijn schrijft zelf op het board (#128, #185). Lokaal gebruikt hij jouw eigen
`gh`-auth; in een workflow kan dat niet — het ingebouwde `GITHUB_TOKEN` is repo-gebonden
en het board hangt onder een persoonlijk account. Daarvoor staan deze drie op
`gjvv13/factory` (en `PROJECT_TOKEN` ook op elke app-repo):

| Naam                  | Soort     | Waarvoor                                                      |
| --------------------- | --------- | ------------------------------------------------------------- |
| `PROJECT_TOKEN`       | secret    | het board schrijven: classic PAT met scope `project` + `repo` |
| `DEPLOY_NOTIFY_URL`   | variabele | het assistent-endpoint dat naar de Matrix-ops-room relayt     |
| `DEPLOY_NOTIFY_TOKEN` | secret    | bearer-token voor dat endpoint                                |

Ontbreekt `PROJECT_TOKEN`, dan slaat de bordstap zacht over en blijven items op
**Uitrollen** staan — een release wordt daar nooit rood van. Dat liep één keer stil vol
(#195); daarom meldt de release het nu in de ops-room. Verloopt de PAT, dan is dat de
melding die je krijgt.
