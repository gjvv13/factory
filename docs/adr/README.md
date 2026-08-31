# Architecture Decision Records (ADR's)

Korte markdown-notities per richtingbepalende platformbeslissing. Eén ADR per
beslissing, niet per issue of per feature.

## Wanneer maak je een ADR aan?

Bij een keuze die het platform raakt en die je niet meer stilletjes terugdraait:
een technologiekeuze, een architectuurpatroon, een procesafspraak. Niet bij elke
commit of elke bugfix.

## Nummering

`NNN-kebab-case-titel.md`, oplopend vanaf 001. Nummer 000 is het sjabloon.

## Een nieuwe ADR aanmaken

1. Kopieer `000-sjabloon.md` naar `NNN-titel.md`.
2. Vul de vier velden in.
3. Commit het bestand.

Er is bewust geen CLI-commando: de handeling is een bestand kopiëren en invullen.

## Overzicht

| #                                                           | Beslissing                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| [001](001-versie-uit-git-tag.md)                            | Versie afleiden uit de nieuwste git-tag                         |
| [002](002-applescript-ipv-eventkit.md)                      | Apple-herinneringen via AppleScript i.p.v. EventKit             |
| [003](003-e2e-sluit-unit-contract-uit-bij-dekking-merge.md) | Dekking-merge meet elke testsoort apart                         |
| [004](004-matrix-client-voor-het-gezin.md)                  | Matrix-client vrij; homeserver dwingt niets af                  |
| [005](005-serieel-stapelen-bouw-reeks.md)                   | Slices serieel stapelen in een bouw-reeks                       |
| [006](006-child-issues-voor-multi-slice.md)                 | Sub-issues als model voor meerdere slices                       |
| [007](007-bouw-nacht.md)                                    | Onbemand bouwen 's nachts                                       |
| [008](008-ooit-label-ijskast.md)                            | `ooit`-label als ijskast voor uitgestelde items                 |
| [009](009-fastlane-nachtbouw.md)                            | Fastlane-baan: nachtbouw merget laag-risico werk op groen       |
| [010](010-externe-plugin-adoptie-beleid.md)                 | Externe plugins: vertrouwenslat voor adoptie (ook onbemand)     |
| [011](011-spike-github-claude.md)                           | GitHub @claude: aanvullen (attended), niet de factory vervangen |
