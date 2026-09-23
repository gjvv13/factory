# Bouw-golf dispatchen vanuit de coördinatie-chat

## Context

`factory brief` (#404) geeft een beslis-gericht overzicht over alle apps, maar
is puur read-only: het toont wat er klaarstaat en laat het handelen aan een
losse `factory orkestreer --soort bouw --issue <n>` per item. Wie 's ochtends
een handvol bouw-klare items over meerdere apps wil starten, herhaalt dat
commando keer op keer en beoordeelt de kosten telkens los.

De vraag: kan de coördinatie-chat met één akkoord een golf aan bouwactiviteiten
aansturen, zonder de mens-poort (kosten én merge) te verliezen?

## Beslissing

**Een nieuw CLI-commando `factory golf`: de actie-tweeling van `factory brief`.**
Brief láát zien, golf láát handelen. Golf leest de bouw-wachtrij over alle apps,
toont de selectie met een kosteninschatting, vraagt één `j/n`-akkoord, en
dispatcht de items daarna serieel als losse bouw-runs.

De scope-verruiming is bewust afgebakend; drie keuzes houden 'm veilig.

### 1. Dispatch ≠ merge, en de mens-poorten blijven

Golf opent hooguit PR's zonder auto-merge (`factory inleveren` default, #573).
Mergen blijft een apart besluit. En vóór er één run start vraagt golf een
kostenakkoord: de preview toont het aantal items en ~$13/item (afgeleid uit
`bouwBudgetPerRun` + `reviewBudgetPerRun`), en zonder een `j` gebeurt er niets.
Dat is dezelfde riem als elders — de coördinatie-chat krijgt reikwijdte, geen
autonomie.

### 2. Subprocess, geen functie-extractie

Golf roept `factory orkestreer --soort bouw --issue <n> --eenmalig` aan als
kindproces (dezelfde CLI die draait, via `process.argv[1]`, niet een globale
`factory` op PATH). Zo hergebruikt het de volledige bouw-cyclus (spiegel,
worktree, claude-run, review, inleveren) zonder die logica uit te rekken. De
lichte overhead — het board wordt per dispatch opnieuw gelezen ter validatie —
weegt niet op tegen de complexiteit van een refactor.

### 3. Plafond, serieel, en faal-door

- **Plafond:** maximaal `MAX_GOLF_ITEMS` (5) per golf, een constante in
  `orkestrator-instellingen.ts` — een vangnet, geen afstemknop. Overschrijding
  weigert met de tip om met `--app` of `--issue` te filteren.
- **Serieel:** één build tegelijk, om de mini te ontzien en de kosten
  voorspelbaar te houden. Geen parallelle builds.
- **Faal-door:** een falende of geëscaleerde build stopt de golf niet. Het item
  krijgt (zoals bij een losse run) het `escalatie`-label en de golf gaat door;
  de eindsamenvatting meldt per item geslaagd/geëscaleerd/mislukt en verwijst
  naar `factory brief` voor het vervolg. Consistent met de nacht-modus.

Elke dispatch wordt geboekt als `interactief` (`boekRun`), niet als
`nacht-bouw`: de golf draait overdag en concurreert niet met het nacht-plafond.

## Alternatieven

- **Functie-extractie i.p.v. subprocess.** Zou de bouw-logica uit `orkestreer`
  moeten uitrekken tot een herbruikbare functie. Meer refactor, meer
  koppelvlak, zonder functioneel verschil voor de gebruiker. Afgewezen.
- **Golf mag ook mergen.** Zou de mens-poort op de PR opheffen. Botst met #573
  en met de simplify-richting (attended-by-default). Afgewezen: dispatch is de
  grens.
- **Parallelle builds.** Sneller, maar belast de mini en maakt de kosten en de
  voortgang onvoorspelbaar. Afgewezen.

## Gevolgen

De coördinatie-chat kan nu handelen, niet alleen tonen — met één akkoord en
binnen een hard plafond. `factory brief` en `factory golf` vormen samen het
zie-en-doe-paar over alle apps. De baan raakt de refinement-wachtrij niet (alleen
bouw) en duwt geen item voorbij een poort: alleen wat al op _Klaar voor Bouwen_
staat komt in aanmerking.

Verwant: #404 (brief), #573 (auto-merge-poort), ADR 007/009 (de nacht-familie).
