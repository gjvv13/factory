# Externe-plugin-adoptie-beleid

## Context

De skills, commands en hooks van het platform zijn nu allemaal zelf bedacht.
Anthropic levert een set officiële, onderhouden plugins (in `anthropics/claude-code`)
die onze thema's raken; #448 en #449 wegen adoptie daarvan tegen zelf bouwen. Ook
buiten Anthropic bestaan marketplaces met plugins.

Een geadopteerde plugin is **code van buiten**. En bij ons geldt: adoptie werkt
**meteen ook onbemand** — een geadopteerde hook draait niet alleen in een
interactieve sessie maar ook in de nacht-werkers, waar hij op elke tool-aanroep
ongezien meedraait. Zonder een vaste lat is dat precies het soort verandering dat
pas in productie opvalt. Dit ADR legt die lat één keer vast, zodat #448, #449 en elke
toekomstige adoptie er dezelfde toets op leggen — niet per item opnieuw bedacht.

## Beslissing

Elke adoptie van een externe plugin voldoet aan vier punten. Ze zijn geen
aanbeveling maar een voorwaarde, juist omdat adoptie onbemand doorwerkt.

1. **Wat een plugin/hook mag.** Een geadopteerde plugin mag niet méér dan wat de
   werker al mag: hij blijft binnen de bestaande toestemmingslijsten
   (`BOUWER_TOEGESTAAN` / `WERKER_TOEGESTAAN`, `src/werker.ts`). Geen nieuwe
   netwerk-egress, geen toegang tot secrets of tokens buiten wat expliciet
   gedeclareerd is, geen schrijfacties buiten de werkmap. Past de plugin daar niet
   in, dan wordt hij niet onbemand ingezet.

2. **Hoe we vaststellen wat het doet.** Vóór adoptie leest een mens (of een
   review-stap) de **échte** hooks/commands/code van de plugin — niet alleen de
   README. Hooks krijgen extra aandacht: zij draaien op tool-aanroepen. Deze
   pre-adoptie-review is verplicht; "het staat in Anthropic's repo" is geen
   vrijstelling.

3. **Pinning.** Adoptie pint op een **specifieke commit of versie**, nooit op een
   bewegende ref (`main`, `latest`). Geen auto-update. Een versie-ophoging is een
   bewuste, opnieuw-gereviewde stap — dezelfde lat als de eerste adoptie.

4. **Onbemande uitvoering.** Omdat een geadopteerde plugin/hook in de nacht-werkers
   meedraait, zijn punt 1–3 hard: pinning, pre-adoptie-review en het niet
   overschrijden van de werker-rechten zijn vereisten, geen nice-to-haves. Een
   geadopteerde hook mag binnen een werker-run niets doen wat de werker zelf niet
   mag.

**Vertrouwenslat naar bron.** Anthropic's eigen repo is de laagste lat (gecontroleerd,
onderhouden). **Third-party marketplaces liggen hoger**: een aparte, bewuste
beslissing per geval, nooit een automatisme en nooit blind in de onbemande pijplijn.

## Alternatieven

- **Per item ad-hoc een vertrouwens-check.** Verworpen: elke keer opnieuw bedacht,
  inconsistent, en makkelijk overgeslagen. Eén gedeeld beleid is stabieler.
- **Nooit externe plugins adopteren.** Verworpen: dan missen we onderhouden, volwassen
  gereedschap — precies de winst die #448/#449 zoeken.
- **Vrij adopteren zonder pinning/review.** Verworpen: externe code die ongezien in een
  onbemande pijplijn draait, is precies het risico dat dit ADR afdekt.

## Verwijzingen

- **Datum:** 2026-08-30
- **Issue:** #448 (evaluatie + herijking #364/#368/#369); toegepast door #449
