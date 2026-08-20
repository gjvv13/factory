import { type Kolom } from '../board.js';
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
export declare function vereisKolom(waarde: string | undefined): Kolom;
export declare function board(issueArgument: string | undefined, kolomArgument: string | undefined): void;
