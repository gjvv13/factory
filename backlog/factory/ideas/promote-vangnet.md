---
id: promote-vangnet
titel: Vangnet voor promote — bevestiging, health vóór swap, rollback
status: idee
aangemaakt: 2026-08-01
---

# Vangnet voor promote — bevestiging, health vóór swap, rollback

## Wat wil ik?

`factory promote` naar prod veiliger maken: bevestiging vragen, de gezondheid
controleren vóórdat het draaiende proces wordt omgewisseld, en terug kunnen
rollen als het misgaat.

## Waarom?

`src/commands/promote.ts` doet nu `git clean -qfd`, dan `pm2 delete` →
`pm2 start`, en checkt de health-endpoint pas nádat het proces al is omgewisseld
(regel ~141). Er is geen dry-run, geen bevestiging voor prod, en geen rollback.
Faalt de health-check, dan is prod al kapot en gooit de CLI alleen een fout — je
blijft met een stukke omgeving zitten. Voor een setup die door één persoon wordt
gedeployd is dit het grootste operationele risico.

## Hoe zie ik het voor me?

```
$ pnpm promote prod v0.3.0
  → build + migrate in een verse clone
  → health-check op de nieuwe clone (proces draait nog niet live)
  → "Prod omzetten van v0.2.0 naar v0.3.0? [j/N]"
  → pas bij 'j': pm2 omwisselen
  → health faalt na omschakelen → automatisch terug naar v0.2.0
```

- Bevestiging vragen bij prod (te onderdrukken met een expliciete `--ja`-vlag
  voor CI).
- Health-check zoveel mogelijk vóór de swap, op de nieuwe versie.
- De vorige draaiende tag onthouden en terugzetten als de nieuwe niet gezond
  wordt.

## Wat weet ik nog niet?

- Kan pm2 een nieuwe versie naast de oude opstarten (andere poort) voor een
  health-check vóór de swap, of accepteren we een kort risicovenster?
- Hoe ver willen we rollback automatiseren — alleen proces terug, of ook een
  migratie terugdraaien (dat kan niet altijd)?
- Wat is het gedrag in CI versus handmatig? CI wil geen interactieve prompt.

## Grofweg hoe groot?

Groot — moet opgesplitst worden. Bijvoorbeeld: (1) bevestiging + `--ja`,
(2) health vóór swap, (3) proces-rollback.
