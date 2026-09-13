# Slices serieel stapelen in een bouw-reeks

> **Achterhaald door #558 (2026-09-13).** Het stapelen bleek niet samen te gaan met
> squash-merge: zodra de onderste slice gesquasht naar `main` gaat, ziet GitHub de
> commits van de bovenste dubbel en blokkeert die als conflict. Sinds #558 takt elke
> slice weer van `origin/main` af (geen `basis`-branch meer); de wachttijd wordt in
> plaats daarvan begrensd met een leeftijdssignaal in de ochtendupdate (#558 slice 2).
> Onderstaande beslissing is niet meer van kracht.

## Context

Een bouw-reeks (`--nacht`) bouwt meerdere items in eigen worktrees, elk vertakt
vanaf `origin/main`. Raken twee items in dezelfde app hetzelfde bestand, dan
conflicteren de latere PR's bij het mergen — de botsing ontstaat pas achteraf, als
de PR gemerged moet worden.

## Beslissing

Binnen één reeks-run onthoudt de lus per app welke branch het laatst gebouwd is.
Het volgende item in dezelfde app vertakt van die branch in plaats van van
`origin/main`. De PR's richten zich nog steeds op `main` (via `gh pr create
--base main`); de stacking zit in de git-historie. Na de merge van de eerste PR
bevat main die wijzigingen al, en de diff van de volgende toont alleen zijn eigen
werk.

De PR-body vermeldt de positie in de reeks en de afhankelijkheid, zodat een
reviewer de stapel 's ochtends begrijpt.

## Alternatieven

- **Rebase na elke merge:** lost het conflict op, maar vereist automatisch
  herschrijven van openstaande PR's — de complexiteit is hoog en de foutmodi
  zijn ondoorzichtig.
- **Parallelle worktrees accepteren en conflicten met de hand oplossen:** werkt
  bij een paar items, maar schaalt niet voor een nachtelijke reeks waar niemand
  bij is.
- **Alleen één item per app per reeks:** te conservatief — de meeste items raken
  niet dezelfde bestanden, en de stacking-aanpak vangt het geval dat ze dat wél
  doen.

## Verwijzingen

- **Datum:** 2026-08-24
- **Issue:** #327
- **Bron:** issue #327 § "Functionele architectuur" — het stacking-diagram
