# GitHub @claude naast de factory: aanvullen, niet vervangen

## Context

De eigen factory orkestreert de idee→bouw→deploy-lus met eigen code: onbemande
werkers op de backlog, een refine/bouw-permissiesplitsing, bordsturing,
budget-plafonds, verify + dekking-ratchet, en een deploy-pijplijn met rooktest.
De native GitHub **@claude**-integratie (issue/PR-mentions → agentic CI) is
precies dat als kant-en-klare bouwsteen. Spike #367 onderzocht — hands-on, met
gemeten kosten — of @claude een deel van die eigen orkestratie kan vervangen of
aanvullen. Bredere aanleiding: bewegen naar gangbare standaarden in plaats van
alles zelf bedenken en onderhouden.

De spike wirete de @claude-actie echt op een wegwerp-issue (#476) met twee
opdrachten: één die geen wijziging bleek te vereisen, en één die een PR afdwong
(#477). Gemeten bewijs:

| Run | Taak                           | Kosten  | Model                          |
| --- | ------------------------------ | ------- | ------------------------------ |
| 1   | lezen + oordelen, géén PR      | $0.2165 | claude-sonnet-5 + haiku-helper |
| 2   | kleine wijziging + branch/push | $0.2197 | claude-sonnet-5 + haiku-helper |

De acht vergelijkingspunten tegen de eigen pijplijn:

| #   | Pijplijnstap                                    | @claude?              | Waarneming                                                                                                                                      |
| --- | ----------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Template-refinement + JSON-verdict              | deels                 | Volgt de prompt, levert gestructureerde markdown — geen afgedwongen schema/verdict-contract zoals `templates/werker-refine.md`                  |
| 2   | Permissie-harness (lees-refine vs schrijf-bouw) | nee                   | Eén agent kiest zelf of hij schrijft; geen `WERKER_`/`BOUWER_TOEGESTAAN`-splitsing per taaksoort                                                |
| 3   | Escalatie mét sessie-hervatting                 | deels                 | Vraag/antwoord kan via comments, maar elke run is een koude start — geen warme resume zoals `orkestreer antwoord` ($0,02 vs $0,32)              |
| 4   | Budget/timeout per run                          | deels                 | Actions-timeout ja; geen per-issue $-plafond zoals `FACTORY_BUDGET_USD` (kosten pas achteraf in de job-log)                                     |
| 5   | Board-kolom zetten                              | nee                   | @claude raakt het board niet aan — dat blijft volledig factory                                                                                  |
| 6   | Verify + dekking-ratchet                        | poort: ja / zelf: nee | Levert een gewone PR, dus `factory verify` + ratchet draaien er ongewijzigd op (bewezen: verify groen op #477). @claude draait zelf geen verify |
| 7   | Code-review als tweede poort                    | nee                   | All-in-one; geen onafhankelijke review-run zoals `templates/werker-review.md`                                                                   |
| 8   | acc→prod promote + rooktest                     | nee                   | Stopt bij de PR; geen deploy-trigger                                                                                                            |

Conflicten en randen:

- **Dubbele trigger:** de actie plaatst zelf een tracking-comment die
  `issue_comment` afvuurt → tweede run. De `if`-guard ziet geen `@claude` in die
  bot-comment → **`skipped`, $0**. Onschadelijk, maar een expliciete actor-guard
  is netter.
- **Buiten de #364-gates:** de PreToolUse-hooks zijn lokale Claude Code-hooks van
  de factory; @claude draait op Anthropic's action-runner en gebruikt die
  hookconfig **niet**. @claude opereert dus buiten de factory-permissiegates.
- **Fastlane (ADR 009):** `auto-merge` bleef `skipping` op de handmatig geopende
  PR — geen botsing, maar ook geen integratie.
- **Geen bypass:** omdat het een gewone PR is, gelden verify + ratchet + ruleset +
  review-poort ongewijzigd.
- **Opent z'n eigen PR niet:** pusht een branch en geeft een "Create PR"-link; de
  PR-opening is een menselijke stap.

## Beslissing

**Conditionele go / hybride.** @claude wordt geadopteerd **naast** de factory, voor
**kleine, goed-afgebakende, mens-getriggerde taken** — reageren op reviewfeedback,
een CI-fout fixen, een kleine wijziging op een issue/PR. Het **vervangt de
factory-orkestratie niet**: de onbemande backlog-lus, de refine/bouw-splitsing, de
bordsturing, de budget-plafonds, de onafhankelijke review-poort en de
deploy-pijplijn blijven eigen code, want geen standaard-bouwsteen levert die nu.

**De grens (wanneer wat):**

- **@claude** — attended hulp op een bestaand issue/PR, één afgebakende stap,
  mens in de lus die de mention plaatst en de PR opent/mergt.
- **De factory-werker** — onbemand, meer-staps, gepoortt werk vanaf de backlog
  (refine → bouw → review → deploy), zonder mens per stap.

Zo ontstaan er geen twee overlappende agentische paden die elkaar en de tokens in
de weg zitten.

**Algemene toets (in de geest van ADR 010):** pak een standaard-bouwsteen waar die
de lat haalt; houd zelfbouw alleen waar de factory iets doet wat standaarden niet
bieden. Deze toets geldt ook voor volgende keuzes (merge-queue, verdere
Dependabot-overname #456).

**Opvolgacties (hardening) voordat @claude leunt op onbemand gedrag:**

1. **Actor-guard** op `claude.yml`, zodat een bot-comment nooit een run kan starten
   (nu al onschadelijk via `skipped`, maar expliciet is netter).
2. **Action pinnen op een commit-SHA** i.p.v. `@v1` — precies wat ADR 010 eist bij
   externe adoptie (geen auto-update).
3. Deze grens (attended-hulp vs onbemande pijplijn) bewaken bij elke nieuwe
   inzet van @claude.

## Alternatieven

- **Volledige no-go (App eraf, `claude.yml` weg).** Afgevallen: @claude bewees
  concrete waarde voor attended hulp tegen lage kosten (~$0,22/kleine taak) en met
  goed oordeel (weigerde terecht een no-op PR), zonder de bestaande poorten te
  omzeilen.
- **Volledige vervanging (factory-orkestratie eruit, alles via @claude).**
  Afgevallen: @claude dekt maar één, mens-getriggerde stap. Het mist het onbemande,
  zelf-sturende deel dat de kern-waarde van de factory is (nachtbouw, refine/bouw-
  splitsing, bordsturing, deploy-gates) en draait bovendien buiten de #364-gates.
  "Naar standaarden" mag hier niet "de factory eruit" worden.
- **Niets doen (blijven bij louter zelfbouw).** Afgevallen: laat een goedkope,
  onderhoudsarme standaard-bouwsteen voor ad-hoc hulp liggen, tegen de richting in
  om naar gangbare standaarden te bewegen.

## Verwijzingen

- **Datum:** 2026-08-31
- **Issue:** #367
- **Spike-bewijs:** test-issue #476, PR #477 (wegwerp, niet gemergd), workflow
  `.github/workflows/claude.yml` (PR #472). Kosten en vergelijkingspunten hierboven
  uit de job-logs van de @claude-runs.
- **Verwant:** ADR 009 (fastlane), ADR 010 (externe-plugin-adoptiebeleid), #456
  (Dependabot neemt bump over), #364 (hooks/gates).
