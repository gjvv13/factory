---
description: Toon de staat van de factory, de backlog en alle applicaties
---

Geef een overzicht van de factory en alles wat eruit gebouwd is. Doe dit:

1. De backlog (één set GitHub Issues in `gjvv13/factory`, zie `WORKFLOW.md`):
   `gh issue list -R gjvv13/factory --state open --limit 100 --json number,title,labels`
   en groepeer het overzicht per `app:`-label en daarbinnen per `status:`-label
   (idea / refined / done).
2. In deze repo: `git status --short`, `git log --oneline -5` en
   `git tag --sort=-v:refname | head -3` — de staat van de factory zelf.
3. Voor elke applicatie naast deze repo (mappen met een `factory.json`): dezelfde
   drie git-commando's, plus `pnpm exec factory env status` en
   `pnpm exec factory flag prod` als die omgeving bereikbaar is.

Vat het samen per applicatie: backlog, code, releases, omgevingen, flags. Noem
daarna de meest logische volgende stap. Verander niets.
