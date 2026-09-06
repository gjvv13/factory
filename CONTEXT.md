# CONTEXT.md — factory

## Glossarium

| Term | Betekenis |
| --- | --- |
| slice | Een zelfstandig afleverbaar stuk werk met eigen acceptatiecriteria; een epic wordt opgesplitst in slices via child-issues (ADR 006) |
| grill | Een gestructureerd interview (frontier-patroon) dat functionele besluiten vastlegt vóór de technische uitwerking begint |
| frontier | De verzameling openstaande vragen waarvan alle voorwaarden vervuld zijn — het algoritme achter de grill |
| ratchet | De dekkings-basislijn die alleen omhoog schuift: het hoogste gemeten niveau wordt vastgelegd en mag niet meer dalen |
| poort | `factory verify` — de kwaliteitspoort die opmaak, lint, types, tests, build, dekking en audit toetst |
| spiegel | Een verse kloon van `origin/main` onder `~/OrkestratorWerk/` waarop een onbemande werker draait; wordt vóór elke run hard teruggezet |
| werkplek | Een git-worktree naast de spiegel (`factory werkplek <issue>`), de geïsoleerde werkmap van een bouw-werker |
| orkestrator | De supervisor (`factory orkestreer`) die het board leest, een werker start en het resultaat op GitHub zet |
| refine-werker | Onbemande werker die de technische helft van een refinement schrijft; leest alleen, schrijft niets naar het bestandssysteem |
| bouw-werker | Onbemande werker die een slice bouwt in een worktree; mag schrijven maar niet pushen of een PR openen |
| escalatie | Een werker stopt met een vraag en advies; het item gaat terug naar de wachtrij met het label `escalatie` tot iemand antwoordt |

## Invarianten

- De versie komt uit de nieuwste git-tag, niet uit `package.json` — de tag is de bron van waarheid (ADR 001).
- Elke testsoort meet alleen zijn eigen laag; geen bestand wordt dubbel gemeten in de dekkings-merge (ADR 003).
- Multi-slice-werk wordt opgesplitst in child-issues onder een epic; elke slice is zelfstandig afleverbaar (ADR 006).
- Binnen één nachtrun stapelt de bouw-werker op de vorige branch, niet op `origin/main`, om merge-conflicten te voorkomen (ADR 005).
- Externe plugins voldoen aan het vier-punten-adoptiebeleid: binnen werker-rechten, vooraf gereviewd, gepin op versie, onbemand werkbaar (ADR 010).
- De werker schrijft nooit naar GitHub — de factory doet dat (`CLAUDE.md` §De onbemande werker).
- De PR is de grens tussen voorstellen en landen; pushen en PR openen staan op de verbodslijst van de bouw-werker (`CLAUDE.md` §De onbemande werker).
- Een bordfout houdt nooit een uitrol tegen: de pijplijn levert software af, de administratie is bijvangst (`CLAUDE.md` §Het bord bijwerken).
- @claude supplementeert de factory voor attended, kleine, scopede taken; de factory houdt de onbemande orkestratie, de refine/bouw-splitsing en de deploy-pijplijn (ADR 011).

## Open vragen

- [ ] Moet de dekkings-ratchet standaard op `blokkeer` in plaats van `waarschuw` nu de meldingen stabiel zijn?
- [ ] Hoe om te gaan met CONTEXT.md-conflicten als meerdere slices tegelijk een term toevoegen?
