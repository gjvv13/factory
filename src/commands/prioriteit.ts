import { bordItems, escalaties, zetPrioriteit, type BacklogItem } from '../board.js';
import { GebruikersFout, kop, ok } from '../shell.js';

/**
 * Zet het Prioriteit-veld op het board, of wist het (#438). Toont daarna de
 * gecombineerde refine- en bouw-wachtrij in prioriteitsvolgorde — zo zie je in één
 * blik wat de wijziging met de volgorde doet.
 */
export function prioriteit(
  issueArgument: string | undefined,
  waardeArgument: string | undefined,
): void {
  const issue = vereisIssue(issueArgument);
  const waarde = leesWaarde(waardeArgument);
  const cwd = process.cwd();

  kop(
    waarde === undefined
      ? `Prioriteit van #${String(issue)} wissen`
      : `Prioriteit van #${String(issue)} op ${String(waarde)} zetten`,
  );
  if (!zetPrioriteit(issue, waarde, cwd)) {
    throw new GebruikersFout(
      `Prioriteit van #${String(issue)} is niet gezet — zie de melding hierboven.`,
    );
  }
  ok(
    waarde === undefined
      ? `#${String(issue)} heeft geen prioriteit meer (FIFO).`
      : `#${String(issue)} heeft nu prioriteit ${String(waarde)}.`,
  );

  // Toon de resulterende rij: board opnieuw lezen zodat de zojuist gezette waarde meekomt.
  const items = bordItems(cwd);
  if (items === undefined) {
    return;
  }
  const geblokkeerd = escalaties(cwd) ?? new Set<number>();
  const refine = items.filter(
    (item) => item.kolom === 'Klaar voor technische refinement' && !geblokkeerd.has(item.issue),
  );
  const bouw = items.filter(
    (item) => item.kolom === 'Klaar voor Bouwen' && !geblokkeerd.has(item.issue),
  );

  toonRij('Refine-wachtrij', refine);
  toonRij('Bouw-wachtrij', bouw);
}

function toonRij(titel: string, items: readonly BacklogItem[]): void {
  kop(`${titel} (${String(items.length)})`);
  if (items.length === 0) {
    process.stdout.write('  —\n');
    return;
  }
  for (const item of items) {
    const nummer = `#${String(item.issue)}`.padEnd(6);
    const prio = item.prioriteit === undefined ? '  —' : String(item.prioriteit).padStart(3);
    process.stdout.write(`  ${prio}  ${nummer} ${(item.app ?? '?').padEnd(12)} ${item.titel}\n`);
  }
}

function vereisIssue(waarde: string | undefined): number {
  const issue = Number.parseInt(waarde ?? '', 10);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new GebruikersFout(
      'Gebruik: factory prioriteit <issuenummer> [getal]\n' +
        '  Met getal: zet de prioriteit (lager = eerder aan de beurt).\n' +
        '  Zonder getal: wis de prioriteit (terug naar FIFO).',
    );
  }
  return issue;
}

/**
 * Leest de prioriteitswaarde: een positief geheel getal, of undefined (wissen).
 * Negatieve getallen en nul zijn een fout: prioriteit is een rangnummer, niet een
 * verschil.
 */
function leesWaarde(waarde: string | undefined): number | undefined {
  if (waarde === undefined) {
    return undefined;
  }
  const getal = Number(waarde);
  if (!Number.isInteger(getal) || getal < 1) {
    throw new GebruikersFout(`Prioriteit moet een positief geheel getal zijn, niet '${waarde}'.`);
  }
  return getal;
}
