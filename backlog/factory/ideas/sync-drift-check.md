---
id: sync-drift-check
titel: sync --check die drift tussen factory en apps signaleert
status: idee
aangemaakt: 2026-08-01
---

# sync --check die drift tussen factory en apps signaleert

## Wat wil ik?

Een manier om te zien dat een applicatie is afgeweken van de factory, zonder
meteen te overschrijven — en die in CI kan falen bij divergentie.

## Waarom?

`factory sync` (`syncNaarApp`) kopieert nu éénrichting en rapporteert alleen wat
het wijzigt. Er is geen check-modus. Gevolg: een uit de factory verwijderd slash
command blijft in elke app achterstaan, en drift wordt pas zichtbaar als iemand
`sync` draait. De CLAUDE.md die in beheer nog assistant beschrijft (zie
[[beheer-docs-kloppend]]) laat zien dat drift al optreedt en niemand het
signaleert. Naarmate er meer apps bijkomen, wordt dit erger.

## Hoe zie ik het voor me?

```
$ factory sync --check assistant
  ✓ ci.yml gelijk
  ✗ .claude/commands/idee.md wijkt af
  ✗ oud-commando.md bestaat in de app maar niet in de factory
  → exit 1
```

- Een `--check` die niets schrijft, verschillen toont en non-zero exit geeft.
- Ook verwijderingen detecteren (bestanden die in de app zijn achtergebleven).
- Optioneel in CI opnemen zodat een PR faalt als de app uit de pas loopt.

## Wat weet ik nog niet?

- Welke bestanden vallen onder de check (alleen de vier gesyncte soorten, of ook
  gedeelde config)?
- Hoe gaan we om met bewuste afwijkingen per app — een negeerlijst?

## Grofweg hoe groot?

Middel (dagdeel).
