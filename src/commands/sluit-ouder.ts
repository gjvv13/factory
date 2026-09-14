import { sluitOuderAlsAf } from '../board.js';
import { GebruikersFout, kop } from '../shell.js';

/**
 * Controleert of de ouder-epic van een zojuist gesloten kind-issue ook gesloten
 * kan worden (#627). Bedoeld als CLI-ingang voor `sluit-ouder.yml`: de workflow
 * vuurt bij elk `issues: closed`-event en draait `node dist/cli.js sluit-ouder <issue>`.
 *
 * De functie zelf is dun: de logica zit in `sluitOuderAlsAf` (board.ts), die
 * recursief door de ouder-keten loopt en alleen `ghIssueOmgeving()` nodig heeft
 * — geen `PROJECT_TOKEN`.
 */
export function sluitOuder(issueRuw: string | undefined): void {
  if (issueRuw === undefined) {
    throw new GebruikersFout('Gebruik: factory sluit-ouder <issue>');
  }
  const issue = Number(issueRuw);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new GebruikersFout(`Ongeldig issuenummer: ${issueRuw}`);
  }
  kop(`Ouder-epic controleren voor #${String(issue)}`);
  sluitOuderAlsAf(issue);
}
