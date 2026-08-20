import { KOLOMMEN, zetKolom } from '../board.js';
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
export function vereisKolom(waarde) {
    if (waarde !== undefined && KOLOMMEN.includes(waarde)) {
        return waarde;
    }
    // De namen opsommen en niet alleen afkeuren: ze bevatten hoofdletters en spaties
    // ("Klaar voor Bouwen"), dus een typefout is eerder regel dan uitzondering.
    throw new GebruikersFout(`Onbekende kolom '${waarde ?? ''}'.\n  Kies er een uit:\n${KOLOMMEN.map((k) => `    ${k}`).join('\n')}`);
}
/** Het issuenummer, of een fout. */
function vereisIssue(waarde) {
    const issue = Number.parseInt(waarde ?? '', 10);
    if (!Number.isSafeInteger(issue) || issue <= 0) {
        throw new GebruikersFout('Gebruik: factory board <issuenummer> "<kolom>"');
    }
    return issue;
}
export function board(issueArgument, kolomArgument) {
    const issue = vereisIssue(issueArgument);
    const kolom = vereisKolom(kolomArgument);
    kop(`#${String(issue)} naar ${kolom}`);
    if (zetKolom(issue, kolom, process.cwd())) {
        ok(`#${String(issue)} staat op ${kolom}`);
        return;
    }
    // `zetKolom` geeft false zowel als het item er al stond als wanneer het niet te vinden
    // was; het waarschuwt in het tweede geval zelf. Hier dus geen fout maken van iets wat
    // misschien gewoon "al goed" is.
    ok('niets verplaatst — het item stond er al, of het staat niet op het board.');
}
//# sourceMappingURL=board.js.map