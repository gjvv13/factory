import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { bordItems, orkestratorComments, type BacklogItem } from '../board.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
import { werkplaatsWortel } from '../werkplaats.js';
import { versieUitHealth } from './promote.js';

/**
 * De derde taaksoort: een werker die accepteert in plaats van refinet of bouwt (#169).
 *
 * Deze slice levert alleen `--dry`: de wachtrij van acceptabele items en, voor het
 * gekozen item, of acc de nieuwe versie draait — zonder dat er iets geschreven wordt.
 */

/** Waar de accepteer-werker uit put: items die gebouwd en uitgerold zijn. */
const ACCEPTEER_KOLOM = 'Uitrollen' as const;

/** De markering waaraan een bewijs-comment van de accepteer-werker te herkennen is. */
export const ACCEPTEER_MARKERING = '<!-- accepteer:bewijs -->';

const APP_CONFIG_BESTAND = 'factory.json';

/** Een item dat geaccepteerd kan worden: het `App`-veld moet gezet zijn. */
export interface Accepteeritem extends BacklogItem {
  readonly app: string;
}

/**
 * De accepteer-wachtrij uit één board-lezing: open items op **Uitrollen** die nog geen
 * bewijs-comment van de accepteer-werker dragen, oudste eerst.
 *
 * Het bewijs-commentfilter maakt de wachtrij idempotent: een al geaccepteerd item valt
 * eruit. De comments worden via REST gelezen (aparte pot), niet via het board; het
 * board zelf wordt precies één keer gelezen (#153).
 */
export function accepteerWachtrij(items: readonly BacklogItem[], cwd?: string): Accepteeritem[] {
  const bruikbaar: Accepteeritem[] = [];
  for (const item of items) {
    if (item.kolom !== ACCEPTEER_KOLOM) {
      continue;
    }
    if (item.app === undefined || item.app === '') {
      waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
      continue;
    }
    // Bewijs-comment check: als de accepteer-werker al een bewijs-comment heeft
    // geplaatst, dan is dit item al geaccepteerd en hoort het niet meer in de rij.
    const comments = orkestratorComments(item.issue, ACCEPTEER_MARKERING, cwd);
    if (comments.length > 0) {
      continue;
    }
    bruikbaar.push({ ...item, app: item.app });
  }
  return bruikbaar;
}

/**
 * Leest de acc-poort van een app uit haar factory.json.
 *
 * Gebruikt de spiegel in de werkplaats, niet de app-map zelf: de orkestrator draait
 * buiten ~/Documents en heeft de spiegels als leesmap.
 */
export function accPoortVan(app: string, wortel: string = werkplaatsWortel): number | undefined {
  const configPad = path.join(wortel, app, APP_CONFIG_BESTAND);
  if (!existsSync(configPad)) {
    return undefined;
  }
  try {
    const config = JSON.parse(readFileSync(configPad, 'utf8')) as {
      poorten?: { acc?: number };
    };
    return config.poorten?.acc;
  } catch {
    return undefined;
  }
}

/** Het resultaat van de acc-versiecontrole. */
export interface AccVersieInfo {
  /** De poort waarop acc van deze app draait. */
  readonly poort: number;
  /** De door /health gemelde versie, of undefined als health niet bereikbaar was. */
  readonly draaiend?: string;
  /** De volledige health-body, of undefined als niet bereikbaar. */
  readonly healthBody?: string;
}

/**
 * Vraagt de draaiende versie op van acc via /health.
 *
 * Dit is een read-only aanroep: alleen een GET op /health, geen schrijvende actie.
 */
export async function accVersie(poort: number): Promise<AccVersieInfo> {
  const url = `http://127.0.0.1:${String(poort)}/health`;
  try {
    const antwoord = await fetch(url);
    if (antwoord.ok) {
      const body = await antwoord.text();
      const versie = versieUitHealth(body);
      return {
        poort,
        ...(versie === undefined ? {} : { draaiend: versie }),
        healthBody: body,
      };
    }
    return { poort };
  } catch {
    return { poort };
  }
}

export interface AccepteerOpties {
  readonly dry?: boolean;
  /** Richt de run op dit issue in plaats van op de kop van de rij. */
  readonly issue?: number;
  /** Injecteerbaar voor tests; in productie de echte wortel in $HOME. */
  readonly werkplaatsWortel?: string;
}

/**
 * Draait de accepteer-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er
 * te zien valt vóórdat er iets gebeurt.
 */
export async function orkestreerAccepteer(opties: AccepteerOpties = {}): Promise<void> {
  if (opties.dry !== true) {
    throw new GebruikersFout(
      'Gebruik: factory orkestreer --soort accepteer --dry (tonen). De accepteer-werker is nog niet gebouwd.',
    );
  }
  const cwd = process.cwd();
  const items = bordItems(cwd);
  if (items === undefined) {
    throw new GebruikersFout(
      'Kon het board niet lezen; zonder wachtrij is er niets te doen.\n' +
        '  Controleer je gh-auth (`gh auth status`) en de GraphQL-limiet\n' +
        '  (`gh api rate_limit --jq .resources.graphql`).',
    );
  }
  const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
  const wachtrij = accepteerWachtrij(items, cwd);

  kop(`Accepteer-wachtrij: ${ACCEPTEER_KOLOM}`);
  if (wachtrij.length === 0 && opties.issue === undefined) {
    ok('niets te accepteren');
    return;
  }
  for (const item of wachtrij) {
    const nummer = `#${String(item.issue)}`.padEnd(6);
    process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}\n`);
  }

  const eerste = kiesAccepteerItem(wachtrij, items, opties.issue, cwd);
  if (eerste === undefined) {
    return;
  }

  // Toon de acc-poort en de draaiende versie voor het gekozen item.
  const poort = accPoortVan(eerste.app, wortel);
  if (poort === undefined) {
    process.stdout.write(
      `\nZou nu toetsen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
        `  Geen factory.json gevonden voor ${eerste.app}; acc-poort onbekend.\n` +
        `Er is niets geschreven — niet naar GitHub, niet naar acc.\n`,
    );
    return;
  }

  const info = await accVersie(poort);

  process.stdout.write(
    `\nZou nu toetsen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
      `  acc-poort: ${String(info.poort)}\n` +
      (info.draaiend !== undefined
        ? `  acc draait: ${info.draaiend}\n`
        : `  acc draait: niet bereikbaar\n`) +
      `Er is niets geschreven — niet naar GitHub, niet naar acc.\n`,
  );
}

/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * Spiegelt `kiesItem` uit de bouw-taaksoort: een gevraagd issue dat niet in de rij
 * staat is een fout mét de reden.
 */
function kiesAccepteerItem(
  wachtrij: readonly Accepteeritem[],
  alles: readonly BacklogItem[],
  issue: number | undefined,
  _cwd: string,
): Accepteeritem | undefined {
  if (issue === undefined) {
    return wachtrij[0];
  }
  const gevraagd = wachtrij.find((item) => item.issue === issue);
  if (gevraagd !== undefined) {
    return gevraagd;
  }
  const inLezing = alles.find((item) => item.issue === issue);
  if (inLezing !== undefined) {
    if (inLezing.kolom !== ACCEPTEER_KOLOM) {
      throw new GebruikersFout(
        `#${String(issue)} staat niet in de accepteer-wachtrij: het staat op ${inLezing.kolom}, niet op ${ACCEPTEER_KOLOM}.`,
      );
    }
    // Op de juiste kolom maar niet in de wachtrij: al geaccepteerd of geen app.
    throw new GebruikersFout(
      `#${String(issue)} staat op ${ACCEPTEER_KOLOM} maar valt uit de wachtrij (al geaccepteerd of geen App-veld).`,
    );
  }
  // Niet in de board-lezing.
  throw new GebruikersFout(`#${String(issue)} staat niet op het board, of is gesloten.`);
}
