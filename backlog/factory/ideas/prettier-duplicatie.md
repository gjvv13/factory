---
id: prettier-duplicatie
titel: Dubbele prettier-config opheffen
status: idee
aangemaakt: 2026-08-01
---

# Dubbele prettier-config opheffen

## Wat wil ik?

Eén bron voor de prettier-config, in plaats van twee kopieën die handmatig in
sync gehouden moeten worden.

## Waarom?

`.prettierrc.json` is byte-identiek aan `configs/prettier.json`. De factory
levert prettier al als pakket-export (`factory/prettier`) en eet haar eigen
eslint-export netjes op via het pakket — maar voor prettier staan er twee losse
kopieën. In een project dat juist om DRY-config draait is dat een geurtje: raken
ze uit de pas, dan formatteert de factory zichzelf anders dan wat ze uitlevert.

## Hoe zie ik het voor me?

- De factory haar eigen prettier-config uit de pakket-export laten lezen (zoals
  bij eslint), zodat er nog één bron is.
- De overgebleven kopie verwijderen.

## Wat weet ik nog niet?

- Kan prettier de config via het pakket resolven zoals eslint dat doet, of is er
  een reden dat er nu een los bestand staat?

## Grofweg hoe groot?

Klein (kwartier).
