---
id: naamgeving-conventie
titel: Naamgevingsconventie vastleggen (NL domein, EN technisch)
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Naamgevingsconventie vastleggen (NL domein, EN technisch)

## Samenvatting

We leggen één taalregel voor identifiers vast en schrijven die in de
coding-guidelines: domein- en procestermen in het Nederlands, Engels alleen waar
we een externe API of een gangbare technische term letterlijk overnemen. Comments
en JSDoc blijven Nederlands. Bestaande afwijkingen ruimen we geleidelijk op bij
aanraken, niet in één grote hernoem-actie.

## Functionele architectuur

### Gedrag

Geen runtime-gedrag. De regel stuurt hoe code (en Claude Code) benoemt. Voorbeeld
van de grens:

```
NL (domein/proces):   berichtenLog, kandidaat, verwerkBericht, poortStap
EN (extern/technisch): loadConfig? → laadConfig, verifyWebhookSignature → controleerWebhookHandtekening
EN (letterlijk over te nemen): InboundMessage-veldnamen die een API dicteert, HTTP-headers, SQL-kolommen die een lib bepaalt
```

### Regels en randgevallen

- **Domein en proces: Nederlands.** Alles wat over de applicatie zelf gaat.
- **Technisch/extern: Engels alleen als het letterlijk overgenomen wordt** — een
  veldnaam uit een externe API, een HTTP-header, een term die geen goede
  Nederlandse tegenhanger heeft en waar vertaling verwarrend zou zijn.
- **Twijfelgeval → Nederlands.** De default is Nederlands; Engels is de
  uitzondering die je kunt uitleggen.
- **Comments/JSDoc blijven Nederlands** (ongewijzigd).

### Wat het expliciet níet doet

- Geen big-bang hernoemronde. Bestaande namen worden meegenomen wanneer je het
  bestand toch aanraakt.
- Geen lint-regel die dit afdwingt (taal is niet betrouwbaar te linten); het is
  een niet-afdwingbare guideline.

## Technische architectuur

### Onderdelen

| Laag  | Bestand                             | Wat er verandert                                |
| ----- | ----------------------------------- | ----------------------------------------------- |
| skill | `skills/coding-guidelines/SKILL.md` | sectie "Naamgeving" met de regel en voorbeelden |
| docs  | `CODING_GUIDELINES.md`              | zo nodig gelijktrekken                          |

De skill wordt via `factory sync` naar de apps verspreid, dus de regel geldt
automatisch overal.

### Datamodel

Geen.

### Externe koppelingen

Geen.

### Feature flag

Geen.

## Slices

### Slice 1 — Regel vastleggen in de guidelines

- **Doel:** de conventie staat zwart-op-wit in de coding-guidelines-skill met
  heldere voorbeelden van de grens.
- **Acceptatiecriteria:**
  - [ ] Sectie "Naamgeving" in `skills/coding-guidelines/SKILL.md`.
  - [ ] Minstens drie voorbeelden: domein (NL), technisch-vertaald (NL),
        letterlijk-extern (EN).
  - [ ] Via `factory sync` beschikbaar in de apps.
- **Tests:** n.v.t.
- **Flag:** geen

## Risico's

- **De grens NL/technisch blijft een oordeel.** De regel "twijfel → Nederlands"
  en de voorbeelden houden het beslisbaar; volledige eenduidigheid is niet het
  doel.
- **Geleidelijk opruimen kan blijven liggen.** Acceptabel: consistentie groeit met
  het aanraken van code, en de regel voorkomt in elk geval nieuwe drift.

## Besluiten

- **NL domein, EN technisch**, conform de keuze in refinement — dit legt de
  huidige praktijk vast in plaats van een grote ombouw af te dwingen.
- **Eén slice.** Dit is een guideline-wijziging; er is niets te bouwen of te
  testen. Het toepassen is doorlopend werk, geen aparte slice.
