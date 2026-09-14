import { lstatSync, readdirSync, readlinkSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { agentsDir } from './paths.js';
import { leesAgentGrenzen } from './agent-definitie.js';

/**
 * Het resultaat van de validatie van één agent-definitie.
 * Bij `ok: false` staat de reden in `fout`.
 */
export interface AgentValidatieResultaat {
  readonly bestand: string;
  readonly ok: boolean;
  readonly fout?: string;
}

/** Leesbare boodschap uit een onbekende fout. */
function boodschap(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Valideert alle `.md`-bestanden in `agents/`.
 *
 * Per definitie wordt getoetst:
 * (a) het frontmatter parst zonder fout via `leesAgentGrenzen()`,
 * (b) er is minstens één `allowedTools`- of `disallowedTools`-lijst,
 * (c) het `name:`-veld in het frontmatter komt overeen met de bestandsnaam (zonder extensie).
 *
 * Geeft een lijst van resultaten terug; een leeg resultaat met `ok: false` is een fout.
 */
export function valideerAgentDefinities(): AgentValidatieResultaat[] {
  const bestanden = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const resultaten: AgentValidatieResultaat[] = [];

  for (const bestand of bestanden) {
    const naam = path.basename(bestand, '.md');

    // (a) Parst het frontmatter zonder fout?
    let grenzen;
    try {
      grenzen = leesAgentGrenzen(naam);
    } catch (err) {
      resultaten.push({
        bestand,
        ok: false,
        fout: `Parse-fout: ${boodschap(err)}`,
      });
      continue;
    }

    // (b) Minstens een allowedTools- of disallowedTools-lijst?
    if (grenzen.allowedTools.length === 0 && grenzen.disallowedTools.length === 0) {
      resultaten.push({
        bestand,
        ok: false,
        fout: 'Geen allowedTools en geen disallowedTools gevonden',
      });
      continue;
    }

    // (c) name:-veld (uit het frontmatter, quotes gestript door leesAgentGrenzen)
    //     komt overeen met de bestandsnaam?
    if (grenzen.name !== naam) {
      resultaten.push({
        bestand,
        ok: false,
        fout: `name-veld '${grenzen.name ?? '(ontbreekt)'}' komt niet overeen met bestandsnaam '${naam}'`,
      });
      continue;
    }

    resultaten.push({ bestand, ok: true });
  }

  return resultaten;
}

/**
 * Scant een map recursief en geeft paden terug die symlinks zijn waarvan het
 * doel niet bestaat (dode symlinks).
 *
 * - `lstatSync` herkent symlinks zonder ze te volgen; `readlinkSync` + `existsSync`
 *   bepalen of het doel bereikbaar is.
 * - Er wordt alleen afgedaald in échte directories (via `statSync`, dat een levende
 *   symlink naar zijn doel volgt) — dus geen ENOTDIR-als-controlflow.
 * - Een cycle-guard op gerealiseerde paden voorkomt oneindige recursie bij een
 *   symlink-lus (bijv. een link naar een voorouder-map).
 * - Een map/pad dat niet gelezen kan worden is "kon niet controleren" en wordt als
 *   zichtbare fout gegooid — nooit stil als "niets gevonden" (coding-guidelines).
 */
export function zoekDodeSymlinks(dir: string): string[] {
  const dodeLinks: string[] = [];
  const bezocht = new Set<string>();

  function scan(map: string): void {
    // Cycle-guard: resolveer naar het echte pad en sla over als we hier al waren.
    let echtPad: string;
    try {
      echtPad = realpathSync(map);
    } catch (err) {
      throw new Error(`kon '${map}' niet resolven bij de symlink-scan: ${boodschap(err)}`, {
        cause: err,
      });
    }
    if (bezocht.has(echtPad)) return;
    bezocht.add(echtPad);

    let items: string[];
    try {
      items = readdirSync(map);
    } catch (err) {
      throw new Error(`kon map '${map}' niet lezen bij de symlink-scan: ${boodschap(err)}`, {
        cause: err,
      });
    }

    for (const item of items) {
      const volledigPad = path.join(map, item);

      let stat;
      try {
        stat = lstatSync(volledigPad);
      } catch (err) {
        throw new Error(
          `kon '${volledigPad}' niet stat'en bij de symlink-scan: ${boodschap(err)}`,
          { cause: err },
        );
      }

      if (stat.isSymbolicLink()) {
        // Resolveer het doel relatief aan de map waar de symlink staat.
        const doel = readlinkSync(volledigPad);
        const absoluutDoel = path.isAbsolute(doel)
          ? doel
          : path.resolve(path.dirname(volledigPad), doel);

        if (!existsSync(absoluutDoel)) {
          dodeLinks.push(volledigPad);
          // Dode symlink: doel bestaat niet, niet verder afdalen.
          continue;
        }
      }

      // Daal alleen af in échte directories. `statSync` volgt een levende symlink naar
      // zijn doel, dus dit dekt echte mappen én symlinks-naar-map in één tak.
      if (statSync(volledigPad).isDirectory()) {
        scan(volledigPad);
      }
    }
  }

  scan(dir);
  return dodeLinks;
}
