import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  bordItems,
  orkestratorComments,
  plaatsComment,
  zetLabel,
  type BacklogItem,
} from '../board.js';
import {
  leesInstellingen,
  metBoekhouding,
  type RunRegel,
  standaardPaden,
  type OrkestratorPaden,
} from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, uitvoerVan, waarschuwing } from '../shell.js';
import { ESCALATIE_LABEL } from '../board.js';
import { versWerkplaats, werkplaatsWortel } from '../werkplaats.js';
import { versieUitHealth } from './promote.js';
import { draaiAccepteerder, type AccepteerUitkomst } from '../werker.js';

/**
 * De derde taaksoort: een werker die accepteert in plaats van refinet of bouwt (#169).
 *
 * Slice 1 (#177) leverde `--dry`: de wachtrij en de acc-preconditie.
 * Slice 2 (#178) levert `--eenmalig`: de werker die de criteria uitoefent op acc.
 */

/** Waar de accepteer-werker uit put: items die gebouwd en uitgerold zijn. */
const ACCEPTEER_KOLOM = 'Uitrollen' as const;

/** De markering waaraan een bewijs-comment van de accepteer-werker te herkennen is. */
export const ACCEPTEER_MARKERING = '<!-- accepteer:bewijs -->';

const APP_CONFIG_BESTAND = 'factory.json';
const EIGENAAR = 'gjvv13';
const MODEL = 'claude-opus-4-6';

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

/**
 * Zoekt de oudste release-tag die de merge van een issue bevat.
 *
 * Strategie: zoek in de git-log van de app-repo naar een merge-commit die
 * `slice/<issue>-` in het onderwerp heeft, en bepaal met
 * `git tag --contains <commit> --sort=v:refname` de oudste tag die hem bevat.
 */
export function verwachteTag(issue: number, appCwd: string): string | undefined {
  const commitHash = uitvoerVan(
    'git',
    ['log', '--all', '--format=%H', `--grep=slice/${String(issue)}-`, '--merges', '-1'],
    appCwd,
  );
  if (commitHash === undefined || commitHash === '') {
    return undefined;
  }
  const tags = uitvoerVan('git', ['tag', '--contains', commitHash, '--sort=v:refname'], appCwd);
  if (tags === undefined || tags === '') {
    return undefined;
  }
  const eerste = tags.split('\n')[0]?.trim();
  return eerste === undefined || eerste === '' ? undefined : eerste;
}

/**
 * Vergelijkt twee versiestrings (met of zonder v-prefix) als semver.
 * Geeft true als `draaiend` ≥ `verwacht`.
 */
export function versieDekt(draaiend: string, verwacht: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const clean = v.replace(/^v/, '');
    const delen = clean.split('.').map(Number);
    return [delen[0] ?? 0, delen[1] ?? 0, delen[2] ?? 0];
  };
  const [dMaj, dMin, dPat] = parse(draaiend);
  const [vMaj, vMin, vPat] = parse(verwacht);
  if (dMaj !== vMaj) return dMaj > vMaj;
  if (dMin !== vMin) return dMin > vMin;
  return dPat >= vPat;
}

export interface AccepteerOpties {
  readonly dry?: boolean;
  /** Accepteert één item en stopt. */
  readonly eenmalig?: boolean;
  /** Richt de run op dit issue in plaats van op de kop van de rij. */
  readonly issue?: number;
  /** Injecteerbaar voor tests; in productie de echte wortel in $HOME. */
  readonly werkplaatsWortel?: string;
  readonly paden?: OrkestratorPaden;
}

/**
 * Draait de accepteer-taaksoort.
 *
 * - `--dry`: toont de wachtrij en de acc-preconditie, schrijft niets.
 * - `--eenmalig`: oefent de criteria van één item uit op acc en plaatst bij
 *   alles-waargenomen een bewijs-comment.
 */
export async function orkestreerAccepteer(opties: AccepteerOpties = {}): Promise<void> {
  if (opties.dry === true && opties.eenmalig === true) {
    throw new GebruikersFout('--dry en --eenmalig sluiten elkaar uit; kies er één.');
  }
  if (opties.dry !== true && opties.eenmalig !== true) {
    throw new GebruikersFout(
      'Gebruik: factory orkestreer --soort accepteer --dry (tonen) of --eenmalig (één item accepteren).',
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

  // Bepaal de verwachte tag: de oudste release die de merge van dit issue bevat.
  const appCwd = path.join(wortel, eerste.app);
  const tag = verwachteTag(eerste.issue, appCwd);

  if (opties.dry === true) {
    const regels = [
      `\nZou nu toetsen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}`,
      `  acc-poort: ${String(info.poort)}`,
    ];

    if (info.draaiend !== undefined) {
      if (tag !== undefined) {
        const dekt = versieDekt(info.draaiend, tag);
        regels.push(
          dekt
            ? `  acc draait: ${info.draaiend} ✓ (verwacht ≥ ${tag})`
            : `  acc draait: ${info.draaiend} ✗ (verwacht ≥ ${tag}) — acc draait de nieuwe versie nog niet`,
        );
      } else {
        regels.push(`  acc draait: ${info.draaiend} (verwachte tag niet bepaalbaar)`);
      }
    } else {
      regels.push(`  acc draait: niet bereikbaar — acc draait de nieuwe versie nog niet`);
    }

    regels.push(`Er is niets geschreven — niet naar GitHub, niet naar acc.`);
    process.stdout.write(regels.join('\n') + '\n');
    return;
  }

  // --- --eenmalig: de werker daadwerkelijk draaien ---

  // Preconditie: draait acc de nieuwe versie? Zo niet, dan stoppen we vóór de
  // claude-run — geen aanroepen, geen bewijs-comment, geen kosten.
  if (info.draaiend === undefined) {
    waarschuwing(
      `#${String(eerste.issue)} (${eerste.app}): acc is niet bereikbaar op poort ${String(poort)}; acceptatie overgeslagen.`,
    );
    return;
  }
  if (tag !== undefined && !versieDekt(info.draaiend, tag)) {
    waarschuwing(
      `#${String(eerste.issue)} (${eerste.app}): acc draait ${info.draaiend}, verwacht ≥ ${tag}; acceptatie overgeslagen.`,
    );
    return;
  }

  const paden = opties.paden ?? standaardPaden();
  const instellingen = leesInstellingen(paden);

  await metBoekhouding(
    {
      paden,
      nu: new Date(Date.now()),
      soort: 'accepteer',
      pot: 'interactief',
      item: eerste,
    },
    () =>
      accepteerAf(
        eerste,
        cwd,
        wortel,
        info,
        instellingen.reviewBudgetPerRun,
        instellingen.werkerEffort,
      ),
    beschrijfAcceptatie,
  );
}

/** Het resultaat van `accepteerAf`, voor het log. */
export interface AccepteerAfResultaat {
  readonly accepteer: AccepteerUitkomst;
}

/** Wat er van een accepteer-run in het log komt. */
function beschrijfAcceptatie(resultaat: AccepteerAfResultaat): RunRegel {
  const { accepteer } = resultaat;
  return {
    uitkomst: accepteer.afloop,
    ...(accepteer.kosten === undefined ? {} : { kosten: accepteer.kosten }),
    ...(accepteer.beurten === undefined ? {} : { beurten: accepteer.beurten }),
  };
}

/** De prompt voor de accepteer-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function accepteerPrompt(item: Accepteeritem, accPoort: number, factoryMap: string): string {
  const sjabloon = readFileSync(path.join(templatesDir, 'werker-accepteer.md'), 'utf8');
  const vervang: Record<string, string> = {
    '{{ISSUE}}': String(item.issue),
    '{{TITEL}}': item.titel,
    '{{APP}}': item.app,
    '{{ACC_POORT}}': String(accPoort),
    '{{FACTORY_MAP}}': factoryMap,
  };
  return Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
}

/**
 * Accepteert één item: draait de accepteer-werker en verwerkt de uitkomst.
 *
 * Het item wordt **niet** verplaatst: bij alles-waargenomen krijgt het een bewijs-
 * comment en blijft op Uitrollen. Dat is bewust: accepteren is niet promoten.
 */
async function accepteerAf(
  item: Accepteeritem,
  cwd: string,
  wortel: string,
  accInfo: AccVersieInfo,
  budgetUsd: number,
  effort: string,
): Promise<AccepteerAfResultaat> {
  kop(`#${String(item.issue)} — ${item.titel}`);

  const spiegel = versWerkplaats(item.app, EIGENAAR, wortel);
  const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);

  const uitkomst = await draaiAccepteerder({
    prompt: accepteerPrompt(item, accInfo.poort, factoryMap),
    werkmap: spiegel,
    sessie: randomUUID(),
    extraMappen: [factoryMap],
    budgetUsd,
    model: MODEL,
    effort,
  });

  verwerkAcceptatie(item, uitkomst, cwd);
  return { accepteer: uitkomst };
}

/**
 * Vertaalt de uitkomst van de accepteer-werker naar wat er op GitHub gebeurt.
 *
 * - Alles `waargenomen` → bewijs-comment mét ACCEPTEER_MARKERING; item blijft staan.
 * - Iets `gefaald` of `niet-waarneembaar` → rapport-comment zonder markering.
 * - Escalatie of mislukt → blokkeer met escalatie-label.
 */
export function verwerkAcceptatie(
  item: Accepteeritem,
  uitkomst: AccepteerUitkomst,
  cwd: string,
): void {
  if (uitkomst.afloop === 'mislukt') {
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
    plaatsComment(
      item.issue,
      `**Acceptatie-run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n` +
        `<sub>${uitkomst.kosten === undefined ? '' : `$${uitkomst.kosten.toFixed(2)}`}` +
        `${uitkomst.beurten === undefined ? '' : ` · ${String(uitkomst.beurten)} beurten`}</sub>`,
      cwd,
    );
    waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
    return;
  }

  const verdict = uitkomst.verdict;
  if (verdict?.uitkomst === 'escalatie') {
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
    plaatsComment(
      item.issue,
      `**Acceptatie-escalatie.**\n\n**Vraag:** ${verdict.vraag}\n\n**Advies:** ${verdict.advies}`,
      cwd,
    );
    ok(`#${String(item.issue)} geëscaleerd.`);
    return;
  }

  if (verdict?.uitkomst !== 'klaar') {
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
    waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitkomst.`);
    return;
  }

  // Beoordeel de criteria: alles-waargenomen → bewijs-comment.
  const allemaalWaargenomen = verdict.criteria.every((c) => c.status === 'waargenomen');

  const tabel =
    `| Criterium | Status | Bewijs |\n| --- | --- | --- |\n` +
    verdict.criteria
      .map((c) => {
        const bewijsTekst =
          c.status === 'waargenomen' && c.bewijs !== undefined
            ? `\`${c.bewijs.aanroep}\` → ${c.bewijs.antwoord.slice(0, 200)}`
            : '—';
        return `| ${c.criterium} | ${c.status} | ${bewijsTekst} |`;
      })
      .join('\n');

  if (allemaalWaargenomen) {
    plaatsComment(
      item.issue,
      `**Acceptatie-bewijs** — alle criteria waargenomen op acc.\n\n${tabel}\n\n${ACCEPTEER_MARKERING}`,
      cwd,
    );
    // Het item wordt NIET verplaatst: het blijft in Uitrollen.
    ok(`#${String(item.issue)} geaccepteerd — bewijs-comment geplaatst.`);
  } else {
    // Niet alles waargenomen: rapporteer wat er is, zonder bewijs-markering.
    plaatsComment(
      item.issue,
      `**Acceptatie-rapport** — niet alle criteria waargenomen.\n\n${tabel}`,
      cwd,
    );
    ok(`#${String(item.issue)} niet volledig geaccepteerd — rapport geplaatst.`);
  }
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
