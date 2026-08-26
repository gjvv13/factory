# Dekking-merge: elke testsoort meet alleen zijn eigen laag

## Context

De gecombineerde-dekking-merge dubbeltelde branches van bestanden die door twee
instrumentaties werden gemeten. De oorzaak: vitest (v8) en c8 rapporteren
volstrekt verschillende branch-locaties voor dezelfde code, zodat istanbuls
positie-union ze niet kan matchen en als losse branches optelt. Het probleem zat
niet in de merge-logica (die unioneert al op bronpositie) maar in de **scope**:
de e2e-meting (c8) draaide op `app/src/**` — de hele app — en hermeet dus
bestanden die unit en contract al meten.

## Beslissing

Elke testsoort meet alleen zijn eigen laag:

| Testsoort | Scope                                        |
| --------- | -------------------------------------------- |
| Unit      | `core/`, `flags/`, `config.ts`               |
| Contract  | `clients/`                                   |
| E2e       | de rest (`http/`, `app.ts`, kanaal-adapters) |

Geen bestand wordt door twee instrumentaties gemeten. De merge-logica
(`coverage-merge.ts`) blijft ongewijzigd — het probleem was de invoer, niet het
samenvoegen.

## Alternatieven

- **Positie-gebaseerde merge verbeteren:** bleek een no-op — istanbul doet dat al.
  De oorspronkelijke aanname (istanbul mash't op index) is weerlegd met bewijs
  tijdens het bouwen.
- **Branches uitsluiten uit de merge:** verbergt het probleem in plaats van het op
  te lossen; het gecombineerde cijfer zou nog steeds afwijken van de werkelijkheid.

## Verwijzingen

- **Datum:** 2026-08-14
- **Issue:** #69
- **Bron:** issue #69 § "Diagnose (bewijs, tijdens het bouwen vastgesteld)";
  CLAUDE.md § "Het cijfer is de merge van de testsoorten"
