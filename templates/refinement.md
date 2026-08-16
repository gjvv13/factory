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

### Natuurlijke taal

Welke acties zijn via **natuurlijke taal** bereikbaar? Standaard: **alle** — elke
gebruikersactie hoort een vrije-taal-ingang te hebben (zie het brein-patroon in de
`coding-guidelines`-skill). Noem per actie een voorbeeldzin en de terugval als het
brein het niet begrijpt. Is een actie bewust alléén een exact commando, motiveer
dat dan onder _Wat het expliciet níet doet_.

### Regels en randgevallen

- <regel of randgeval en het gewenste gedrag>

### Wat het expliciet níet doet

Grenzen zijn even belangrijk als de functie zelf.

## Technische architectuur

### Onderdelen

Welke modules komen erbij of veranderen, per laag (zie de `coding-guidelines`-skill):

| Laag     | Bestand                   | Wat er verandert |
| -------- | ------------------------- | ---------------- |
| core     | `app/src/core/...`        |                  |
| db       | `app/src/db/schema.ts`    |                  |
| http     | `app/src/http/routes/...` |                  |
| channels | `app/src/channels/...`    |                  |

### Datamodel

Nieuwe of gewijzigde tabellen, en de migratie die daarvoor nodig is.

### Externe koppelingen

Welke diensten worden aangeroepen, en welk contract hoort daarbij? Geen uitgaande
koppeling zonder test die het contract vastlegt: een Pact als de andere kant een
van onze eigen apps is, anders een opgenomen respons met een schema-check (zie
_Tests_ in de `coding-guidelines`-skill).

### Feature flag

Naam van de flag en wanneer hij aan mag in productie.

## Slices

Elke slice is zelfstandig af: werkt, is getest, kan naar productie — zie _Klaar_ in
de `coding-guidelines`-skill voor de volledige lijst. Als een slice alleen zin
heeft samen met de volgende, is de opdeling verkeerd.

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
