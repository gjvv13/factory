# Apple-herinneringen via AppleScript i.p.v. EventKit

## Context

De apple-app moet taken in Apple Herinneringen en notities in Apple Notities
kunnen wegzetten. macOS biedt meerdere wegen: EventKit (het Cocoa-framework),
Shortcuts (`/usr/bin/shortcuts`), een Swift-helper, of AppleScript via `osascript`.
De Mac mini is het doelplatform en draait als pm2-achtergrondproces.

## Beslissing

**AppleScript via `osascript`**, zowel voor Herinneringen als voor Notities. Een
haalbaarheids-spike op de mini (2026-08-15) bevestigde dat `osascript` vanuit een
pm2-proces werkt — TCC kent toestemming toe aan het verantwoordelijke proces, en
pm2 onder `launchd` krijgt die toestemming.

## Alternatieven

- **EventKit (Swift-helper):** vereist een gecompileerde binary en een aparte
  TCC-toekenning. Bovendien dekt EventKit alleen Herinneringen — voor Notities
  bestaat geen EventKit-equivalent, dus er zouden twee verschillende paden nodig
  zijn.
- **Shortcuts (`/usr/bin/shortcuts`):** omslachtiger, minder goed scriptbaar, en
  voegt een onnodige abstractielaag toe.
- **Swift-bridge met `Foundation`:** meer complexiteit zonder voordeel t.o.v.
  AppleScript voor deze twee bewerkingen.

## Verwijzingen

- **Datum:** 2026-08-15
- **Issue:** #26
- **Bron:** issue #26 § "Haalbaarheids-spike: uitgevoerd, groen ✅"
