# Bugs uitgezonderd van functioneel-eerst

## Context

De pijplijn is functioneel-eerst: stap 2 (`/functioneel`) legt vast **wat** een
item moet doen — dat weet alleen de gebruiker — en stap 3 (`/refine`) werkt het
technisch uit. De #364-gate dwingt die volgorde af: een issue-body met technische
secties zonder functionele secties wordt geweigerd, zowel op het onbemande pad
(`heeftFunctioneleSecties` in `src/commands/orkestreer.ts`) als op het interactieve
pad (`claude-hooks/gate-refine.sh`). Voor een feature is dat terecht: het gewenste
gedrag is een productkeuze.

Voor een **bug** is dat gedrag anders van aard. Het gewenste gedrag van een bug is
definitorisch — "herstel wat kapot is" — en volgt uit het defect zelf, niet uit een
keuze die de gebruiker nog moet maken. Een `type:bug` door de functionele grilling
sturen levert dus een lege of gekunstelde frontier op: de werker zou functionele
besluiten moeten _verzinnen_ om de gate te passeren, precies wat de grill verbiedt.
Dat blokkeerde de onbemande fastlane voor getriageerde bugs (#767, besluit 3a).

## Beslissing

Een getriageerde `type:bug` is uitgezonderd van functioneel-eerst; features blijven
functioneel-eerst en attended.

- **Gate.** Een nieuwe geëxporteerde helper `magRefinen(labels, body)` =
  `labels.includes('type:bug') || heeftFunctioneleSecties(body)` bepaalt of een item
  de refine-gate voorbij mag. De uitzondering zit op de call-site (`werkAf`), niet in
  `heeftFunctioneleSecties`: die functie kent alleen de body, de labels leven op het
  item. Zo blijft `heeftFunctioneleSecties` puur en apart testbaar.
- **Werker.** `bouwPrompt` geeft via de placeholder `{{SOORT}}` mee of het item een
  bug of een feature is. Bij een bug bouwt de werker geen frontier en escaleert hij
  niet op ontbrekende functionele secties; hij neemt één vaste notitie op — "Herstel
  het in dit issue beschreven gedrag; dit is een bugfix, geen productkeuze." — als
  `## Functionele besluiten`. Zo is de door de CLI weggeschreven body meteen
  gate-eerlijk, ook voor een latere her-refine. De regel staat in
  `templates/werker-refine.md` én in de `functioneel-grilling`-skill, zodat het
  interactieve `/refine`-pad (dat dezelfde skill laadt) dezelfde uitzondering erft.
- **`gate-refine.sh` blijft ongewijzigd.** Hij is label-agnostisch en ziet alleen de
  body-file. Doordat de minimale notitie in de body staat, passeert de bug de
  bestaande grep op `## Functionele besluiten` op eigen kracht — geen extra
  `gh`-lezing in een hook.

De scope-knip is strikt aan het `type:bug`-label gebonden: zonder dat label valt
`magRefinen` terug op `heeftFunctioneleSecties` en volgt het item ongewijzigd het
functioneel-eerst-pad. Wat de fastlane op mag, triageert de mens (#767, besluit 1);
de `onbemand-werken`-skill blijft escaleren op migraties, features en grote bugs.

## Alternatieven

- **De CLI voegt de notitie toe aan `verdict.body`.** Broos: de plaatsing en volgorde
  van een ingevoegde sectie zijn lastig robuust te maken, en het botst met het
  principe dat de uitkomst uit de JSON van de werker komt en niet door de CLI
  gemuteerd wordt. Bovendien dekt de CLI-route het interactieve `/refine`-pad niet.
- **De uitzondering in `heeftFunctioneleSecties`.** Die functie krijgt alleen de body;
  de labels zouden er dan doorheen gevlochten moeten worden, wat de gate-hook (die
  geen labels heeft) en de tests onnodig verstrengelt.
- **`gate-refine.sh` labels laten ophalen.** Een `gh`-lezing in een pre-hook is traag
  en broos; de zelfbeschrijvende body lost hetzelfde op zonder netwerk.

## Verwijzingen

- **Datum:** 2026-09-23
- **Issue:** #782 (epic #767)
