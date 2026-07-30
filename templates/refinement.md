---
id: <kort-kebab-case-id>
titel: <korte titel>
status: refined
aangemaakt: <JJJJ-MM-DD>
gerefined: <JJJJ-MM-DD>
---

# <Titel>

## Samenvatting

Wat gaan we bouwen, in drie regels. Iemand die dit leest weet daarna waar het
over gaat zonder de rest te lezen.

## Functionele architectuur

### Gedrag

Wat kan de gebruiker straks, precies? Schrijf de gesprekken of aanroepen uit,
inclusief wat er gebeurt als het misgaat.

```
ik:      <bericht>
factory: <antwoord>
```

### Regels en randgevallen

- <regel of randgeval en het gewenste gedrag>

### Wat het expliciet níet doet

Grenzen zijn even belangrijk als de functie zelf.

## Technische architectuur

### Onderdelen

Welke modules komen erbij of veranderen, per laag (zie `CODING_GUIDELINES.md`):

| Laag     | Bestand                   | Wat er verandert |
| -------- | ------------------------- | ---------------- |
| core     | `app/src/core/...`        |                  |
| db       | `app/src/db/schema.ts`    |                  |
| http     | `app/src/http/routes/...` |                  |
| channels | `app/src/channels/...`    |                  |

### Datamodel

Nieuwe of gewijzigde tabellen, en de migratie die daarvoor nodig is.

### Externe koppelingen

Welke diensten worden aangeroepen, en welk contract hoort daarbij? Geen externe
koppeling zonder contract test.

### Feature flag

Naam van de flag en wanneer hij aan mag in productie.

## Slices

Elke slice is zelfstandig af: werkt, is getest, kan naar productie. Als een
slice alleen zin heeft samen met de volgende, is de opdeling verkeerd.

### Slice 1 — <naam>

- **Doel:** <wat werkt er daarna>
- **Acceptatiecriteria:**
  - [ ] <toetsbaar criterium>
- **Tests:** unit: <wat> · contract: <wat of n.v.t.> · e2e: <wat>
- **Testdata:** welke fixtures erbij komen of veranderen
- **Flag:** <naam of geen>

### Slice 2 — <naam>

...

## Risico's

Wat kan er misgaan, en wat doen we als dat gebeurt?

## Besluiten

Keuzes die tijdens de refinement zijn gemaakt, met de reden. Zodat je later niet
opnieuw dezelfde discussie voert.
