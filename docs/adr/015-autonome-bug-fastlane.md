# De autonome bug-fastlane landt op de schone gate

## Context

Epic #767 knoopt drie bestaande schakels tot één keten waarmee een getrieerde bug
onbemand van _Klaar voor technische refinement_ naar _Done_ stroomt: triage zet de
labels en de kolom (#783), de refine-nacht werkt de bug bug-exempt uit (#782) en
`rondAf` promoveert 'm naar _Klaar voor Bouwen_, waarna de bouw-nacht 'm via
`fastlaneWachtrij` oppakt.

Er waren twee auto-merge-poorten in `inleveren`:

- de **#401-poort** (`opties.fastlane === true`): merget op groen zodra het issue
  `fastlane`/`type:bug` draagt — de bewuste mens-afwijking van akkoord-voor-inleveren
  bij een interactieve `factory ... --baan fastlane`;
- de **#573-poort** (de default): merget alleen als het issue `auto-merge-ok` draagt
  **én** de code-review-gate schoon is (`reviewGateSchoon`).

De nacht-fastlane gaf `fastlane: true` door en landde dus op de lossere #401-poort,
terwijl #767-besluit 4 de autonome merge expliciet aan de **schone** #573-gate bindt —
juist waarvoor triage `auto-merge-ok` stempelt. De ketens selectie (fastlane) en
landing (#573) liepen daardoor uiteen.

## Beslissing

De autonome nacht-fastlane landt op de #573-schone-gate, niet op de #401-poort.

- In de nacht-fastlane-tak geeft `bouwAf` géén `fastlane: true` meer aan `inleveren`.
  Een expliciete parameter `autonoom` onderscheidt de nacht-tak van de interactieve
  `--baan fastlane`: `viaFastlanePoort = baan === 'fastlane' && autonoom !== true`.
- `fastlaneWachtrij` blijft de **selectie** (eigen cap, `nacht-fastlane`-pot); alleen de
  **landing** verschuift. Auto-merge gaat 's nachts dus alleen aan bij `auto-merge-ok`
  (triage, #783) én een schone review-gate — anders een menselijke merge met PR-comment.
- De interactieve `--baan fastlane` (#401) blijft ongewijzigd: een mens die die vlag
  bewust zet, houdt de merge-op-groen.

Er komt geen nieuwe fase en geen nieuwe rem bij: #784 is knoopwerk plus borging (een
contracttest op de keten-overgangen en de uitsluitingen). De kill-switch is de
bestaande `FACTORY_FASTLANE_CAP=0`, die de hele autonome bouw-nacht uitzet.

## Alternatieven

- **De #401-poort strenger maken.** Dan zou de interactieve `--baan fastlane` mee
  veranderen, terwijl die bewust losser is. De twee poorten gescheiden houden bewaart
  beide bedoelingen.
- **Een nieuwe feature flag voor de autonome landing.** Overbodig: de scoping zit al in
  de drie triage-labels en de fastlane-cap. Nog een rem verbergt alleen waar de knop zit.
- **`baan==='fastlane' && reeks!==undefined` als impliciete nacht-detectie.** Broos: het
  koppelt de landings-keuze aan een niet-gerelateerd implementatiedetail. De expliciete
  `autonoom`-parameter leest wat hij bedoelt.

## Verwijzingen

- **Datum:** 2026-09-23
- **Issue:** #784 (epic #767); envelop #767-besluit 4; poorten #401 en #573; ADR 014 (#782)
