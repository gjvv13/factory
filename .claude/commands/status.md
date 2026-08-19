---
description: Toon de staat van de factory, de backlog en alle applicaties
---

Geef een overzicht van de factory en alles wat eruit gebouwd is. Doe dit:

1. De backlog (één set GitHub Issues in `gjvv13/factory`, zie `WORKFLOW.md`). De
   applicatie is een kolom (het `App`-veld) op het board, niet meer een label:
   `gh project item-list 2 --owner gjvv13 --format json --limit 100`
   en groepeer het overzicht per `App`-veld en daarbinnen per kolom (`status` in de
   json): Idee / Functioneel uitwerken / Technisch refinen / Bouwen / In aanbouw /
   Uitrollen / Done. Noem apart wat in **Functioneel uitwerken** staat (dat wacht op
   een gesprek met de gebruiker), wat in **Bouwen** staat (dat kan opgepakt worden)
   en wat het label `escalatie` draagt (dat wacht op een antwoord).
2. In deze repo: `git status --short`, `git log --oneline -5` en
   `git tag --sort=-v:refname | head -3` — de staat van de factory zelf.
3. Voor elke applicatie naast deze repo (mappen met een `factory.json`): dezelfde
   drie git-commando's, plus `pnpm exec factory env status` en
   `pnpm exec factory flag prod` als die omgeving bereikbaar is.

Vat het samen per applicatie: backlog, code, releases, omgevingen, flags. Noem
daarna de meest logische volgende stap. Verander niets.
