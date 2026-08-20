import { KOLOMMEN, zetKolomUitkomst, type Kolom } from '../board.js';
import { GebruikersFout, kop, ok } from '../shell.js';

/**
 * Eén item van kolom veranderen, via de gerichte board-query (#223).
 *
 * Bestaat omdat de weg buitenom duur is: `gh project item-list` kost 102 GraphQL-punten
 * per aanroep, en de pot is 5000 per uur voor het hele account. Op 2026-08-20 stond de
 * teller aan het eind van de dag op 35, puur door kolomwijzigingen vanuit de regie-chat.
 * `board.ts` zoekt item-id, veld-id, optie-id én de huidige kolom in één document op voor
 * 1 à 2 punten; dit commando ontsluit dat, zodat groomen niet meer kost dan het waard is.
 */

/** De kolom, of een fout die zegt welke er zijn. */
export function vereisKolom(waarde: string | undefined): Kolom {
  if (waarde !== undefined && (KOLOMMEN as readonly string[]).includes(waarde)) {
    return waarde as Kolom;
  }
  // De namen opsommen en niet alleen afkeuren: ze bevatten hoofdletters en spaties
  // ("Klaar voor Bouwen"), dus een typefout is eerder regel dan uitzondering.
  throw new GebruikersFout(
    `Onbekende kolom '${waarde ?? ''}'.\n  Kies er een uit:\n${KOLOMMEN.map((k) => `    ${k}`).join('\n')}`,
  );
}

/** Het issuenummer, of een fout. */
function vereisIssue(waarde: string | undefined): number {
  const issue = Number.parseInt(waarde ?? '', 10);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new GebruikersFout('Gebruik: factory board <issuenummer> "<kolom>"');
  }
  return issue;
}

export function board(issueArgument: string | undefined, kolomArgument: string | undefined): void {
  const issue = vereisIssue(issueArgument);
  const kolom = vereisKolom(kolomArgument);

  kop(`#${String(issue)} naar ${kolom}`);
  // Bewust `zetKolomUitkomst` en niet `zetKolom`: die laatste geeft één boolean voor drie
  // verschillende dingen — verzet, stond er al, en het is mislukt. Met een boolean werd
  // een mislukte aanroep (GraphQL-limiet op, geen leesrecht) gemeld als "niets
  // verplaatst" met een groen vinkje. Gemeten op 2026-08-20, en precies het soort stille
  // misstand dat deze week drie keer is opgeschreven.
  const uitkomst = zetKolomUitkomst(issue, kolom, process.cwd());
  if (uitkomst === 'verzet') {
    ok(`#${String(issue)} staat op ${kolom}`);
    return;
  }
  if (uitkomst === 'al-goed') {
    ok(`#${String(issue)} stond al op ${kolom} — niets te doen.`);
    return;
  }
  // `zetKolomUitkomst` heeft de reden al gemeld; hier gaat het erom dat de aanroeper
  // weet dat het níet gebeurd is.
  throw new GebruikersFout(`#${String(issue)} is niet verplaatst — zie de melding hierboven.`);
}
