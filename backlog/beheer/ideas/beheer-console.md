---
id: beheer-console
titel: Beheer-applicatie (ops-console) — overkoepelend
status: idee
aangemaakt: 2026-07-30
---

# Beheer-applicatie (ops-console) — overkoepelend

## Wat wil ik?

Een aparte, kleine beheer-applicatie die de operationele bediening van alle
applicaties bundelt: één plek voor het health-overzicht, de feature flags en het
log-niveau — in plaats van die knoppen in elke domein-app apart te bouwen.

## Waarom?

Flags, log-niveau en health zijn ops en observability, geen domeinlogica. Ze
horen niet thuis in de WhatsApp-assistant; die zou er alleen troebeler van
worden. En het health-overzicht is sowieso app-overstijgend. Een dun console
boven de applicaties houdt de domein-apps schoon, schaalt mee als er meer apps
bijkomen, en dogfoodt het factory-skelet voor het eerst voor iets anders dan een
domein-app. De apps exposen al (of gaan exposen) loopback admin-API's
(`/health`, `/admin/flags`); de beheer-app is de UI en aggregator daar bovenop —
de app blijft eigenaar van z'n eigen knoppen.

## Hoe zie ik het voor me?

```
Beheer

  Health        assistant · dev/acc/prod · status, versie, kanaal, uptime
  Flags         kies een app+omgeving → flags aan/uit
  Log-niveau    kies een app+omgeving → niveau live omzetten
```

Dit idee is de paraplu; de concrete functies staan als losse ideeën in dezelfde
`beheer`-backlog:

- Health-overzicht over alle apps/omgevingen — `health-overzicht.md`
- Flags beheren via een pagina — `flag-beheer.md`
- Log-niveau live aanpassen — `log-niveau.md`

Die drie beschrijven het gedrag per functie; dit idee gaat over of ze samen één
nieuwe applicatie worden, en wat dat betekent.

## Wat weet ik nog niet?

- **Wordt dit echt een eigen applicatie** (`factory nieuw beheer`), met een eigen
  repo en deploy? Vermoedelijk ja — dat is de hele reden. Maar het moment waarop
  we hem opzetten hangt af van hoeveel er al is om te beheren.
- **Ontdekking:** hoe weet de beheer-app welke applicaties en omgevingen er zijn?
  De apps hebben elk een `factory.json` met naam en poorten, naast de
  factory-repo. Een register, een afgesproken map, of iets anders?
- **Bereikbaarheid en beveiliging:** de admin-routes zijn nu loopback-only zonder
  auth. Wil ik dit console óók vanaf mijn telefoon kunnen gebruiken (net als de
  WhatsApp-gedachte "altijd bij me"), dan is authenticatie nodig. Dit is de
  grootste nieuwe vraag en raakt alle drie de functies.
- **Scope van versie één:** waarschijnlijk alleen-lezen health plus het omzetten
  van flags en log-niveau. Onomkeerbare acties (herstarten, promoten vanaf de
  pagina) horen niet in een eerste versie.
- **Verhouding tot de drie losse ideeën:** worden die uiteindelijk de slices van
  deze app, of blijven flag-beheer en log-niveau ook los bruikbaar binnen een
  enkele app? Dat bepalen we bij de refinement.
- **Verhouding tot de factory-CLI:** overlapt met `factory env status` en
  `factory flag`; vult het console die aan met een visuele laag, of vervangt het
  ze deels?

## Grofweg hoe groot?

Groot — dit is een nieuwe applicatie en moet opgesplitst worden. De losse functies
(health, flags, log-niveau) zijn elk klein tot middel; het nieuwe werk zit in de
app zelf opzetten, het ontdekken van de andere applicaties, en de
bereikbaarheid/authenticatie als het console van buiten de loopback moet kunnen.
