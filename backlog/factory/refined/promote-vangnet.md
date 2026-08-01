---
id: promote-vangnet
titel: Vangnet voor promote — bevestiging, health vóór swap, rollback
status: refined
aangemaakt: 2026-08-01
gerefined: 2026-08-01
---

# Vangnet voor promote — bevestiging, health vóór swap, rollback

## Samenvatting

`factory promote` wordt veiliger: het vraagt bevestiging bij prod, controleert de
gezondheid van de nieuwe versie zoveel mogelijk vóórdat het draaiende proces wordt
omgewisseld, en rolt het proces automatisch terug naar de vorige tag als de nieuwe
versie na de swap niet gezond wordt. Migraties worden niet teruggedraaid.

## Functionele architectuur

### Gedrag

```
$ pnpm promote prod v0.3.0
  ==> Promoveren van v0.3.0 naar prod (assistant)
  ==> Tag uitchecken … build … migreren … (in de verse werkmap)
  ==> Controle vooraf: v0.3.0 gezond op tijdelijke poort … ✓
  Prod omzetten van v0.2.0 naar v0.3.0? [j/N] j
  ==> Omgeving herstarten (pm2)
  ==> Controleren of prod leeft … ✓
  ✓ prod is gezond: {"status":"ok","versie":"0.3.0"}
```

Bij een falende controle ná de swap:

```
  ==> Controleren of prod leeft … ✗ (Werd niet gezond binnen 30s)
  ! Terugrollen naar v0.2.0
  ==> Omgeving herstarten (pm2) op v0.2.0 … ✓
  ✗ Promote afgebroken: v0.3.0 werd niet gezond, prod draait weer op v0.2.0
```

In CI of niet-interactief:

```
$ pnpm promote prod v0.3.0 --ja      # bevestiging overslaan
```

### Regels en randgevallen

- **Bevestiging alleen bij prod.** `acc` promoveert zonder prompt (daar wordt ook
  geseed). Prod vraagt altijd, tenzij `--ja` is meegegeven.
- **Niet-interactieve shell zonder `--ja`:** afbreken met een duidelijke melding
  in plaats van blijven wachten. `run()` sluit stdin al; de prompt moet expliciet
  een tty detecteren.
- **Eerste deploy (geen vorige tag draaiend):** er is niets om naar terug te
  rollen. Faalt de health dan, dan afbreken met de melding dat er geen vorige
  versie is; de werkmap blijft op de nieuwe (kapotte) tag staan.
- **Controle vooraf niet altijd volledig mogelijk:** zie Besluiten. De pre-swap
  health test de build en migratie in de werkmap; de definitieve check blijft ná
  de swap op de echte poort.
- **Rollback faalt zelf:** dan hard stoppen met een expliciete melding dat
  handmatig ingrijpen nodig is — nooit stilletjes doorgaan.

### Wat het expliciet níet doet

- Geen migratie-rollback. Een migratie die al draaide blijft staan; we melden dat
  in de afbreekmelding zodat je weet dat de vorige versie tegen een nieuwer schema
  draait.
- Geen blauw-groen of nul-downtime-deploy. Er blijft een kort venster rond de
  `pm2 delete`/`start`.
- Geen automatische acc-bevestiging of acc-rollback (acc mag stuk).

## Technische architectuur

### Onderdelen

| Laag     | Bestand                        | Wat er verandert                                                  |
| -------- | ------------------------------ | ----------------------------------------------------------------- |
| commands | `src/commands/promote.ts`      | bevestiging, pre-swap health, onthoud vorige tag, rollback-pad    |
| shell    | `src/shell.ts`                 | helper `bevestig(vraag)` (tty-detectie) en evt. `isInteractief()` |
| cli      | `src/cli.ts`                   | vlag `--ja` doorgeven aan promote                                 |
| test     | `test/promote.test.ts` (nieuw) | zie [[cli-commando-tests]]                                        |

### Datamodel

Geen. De "vorige tag" wordt afgeleid uit de draaiende werkmap
(`git describe --tags` vóór het uitchecken van de nieuwe tag).

### Externe koppelingen

Geen nieuwe. `pm2`, `git` en de `/health`-fetch bestaan al.

### Feature flag

Geen — dit is CLI-gedrag, geen applicatiefunctie.

## Slices

### Slice 1 — Bevestiging bij prod

- **Doel:** prod vraagt bevestiging; `--ja` slaat over; niet-interactief zonder
  `--ja` breekt netjes af.
- **Acceptatiecriteria:**
  - [x] `promote prod` zonder `--ja` in een tty vraagt "[j/N]" en stopt bij nee.
  - [x] `--ja` slaat de prompt over.
  - [x] Niet-interactief zonder `--ja` → `GebruikersFout` met heldere melding.
  - [x] `promote acc` vraagt niets.
- **Tests:** unit: `bevestig()` en de vlagverwerking met een gemockte tty/stdin ·
  contract: n.v.t. · e2e: n.v.t.
- **Flag:** geen

### Slice 2 — Health-check vóór de swap

- **Doel:** de nieuwe versie wordt in de werkmap gebouwd, gemigreerd en op een
  tijdelijke poort gezond bevonden vóór `pm2 delete`.
- **Acceptatiecriteria:**
  - [ ] Faalt de pre-swap health, dan wordt het draaiende proces niet aangeraakt.
  - [ ] De bestaande post-swap health blijft als definitieve controle staan.
- **Tests:** unit: de volgorde (pre-swap health vóór delete) met gemockte
  `run`/`fetch` · e2e: n.v.t.
- **Flag:** geen

### Slice 3 — Automatische proces-rollback

- **Doel:** faalt de post-swap health, dan herstart pm2 automatisch op de vorige
  tag en breekt de promote af met een niet-nul exit.
- **Acceptatiecriteria:**
  - [ ] Vorige tag wordt onthouden vóór het uitchecken.
  - [ ] Bij falen: pm2 draait weer op de vorige tag, exit ≠ 0, melding noemt dat
        migraties niet zijn teruggedraaid.
  - [ ] Geen vorige tag → afbreken met "geen versie om naar terug te rollen".
  - [ ] Faalt de rollback zelf → hard stoppen met "handmatig ingrijpen nodig".
- **Tests:** unit: rollback-pad met gemockte `run` · e2e: n.v.t.
- **Flag:** geen

## Risico's

- **Pre-swap health dekt niet alles:** een probleem dat pas onder de echte
  ecosystem-env of poort optreedt, valt pas ná de swap op. Daarom blijft de
  post-swap check + rollback bestaan; de pre-swap check is een extra zeef, geen
  garantie.
- **Schema-drift na rollback:** de vorige versie draait tegen een nieuwer schema
  als de migratie al liep. We draaien migraties niet terug (bewust); de melding
  maakt dit expliciet zodat je het weet.
- **Rollback vergroot de code in het gevaarlijkste commando.** Vandaar de tests
  in [[cli-commando-tests]] als voorwaarde om dit met vertrouwen te bouwen.

## Besluiten

- **Wel proces-rollback, geen migratie-rollback.** Migraties terugdraaien is niet
  altijd mogelijk (destructieve migraties) en fors complexer; het risico daarvan
  weegt niet op tegen de winst nu. Keuze bevestigd tijdens refinement.
- **Pre-swap health op een tijdelijke poort.** pm2 kan de nieuwe versie naast de
  oude starten op een vrije poort voor de check; lukt dat niet betrouwbaar, dan
  valt slice 2 terug op "build + migrate slagen" als pre-swap zeef en leunt de
  echte gezondheid op de bestaande post-swap check. Uit te zoeken in slice 2.
- **`--ja` i.p.v. een interactieve prompt onderdrukken via env.** Eén expliciete
  vlag is voorspelbaarder in CI dan tty-heuristiek.
