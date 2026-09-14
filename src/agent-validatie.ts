import { lstatSync, readdirSync, readFileSync, readlinkSync, existsSync } from 'node:fs';
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
        fout: `Parse-fout: ${err instanceof Error ? err.message : String(err)}`,
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

    // (c) name:-veld komt overeen met bestandsnaam?
    const inhoud = readFileSync(path.join(agentsDir, bestand), 'utf8');
    const nameMatch = /^name:\s*(.+)$/m.exec(inhoud);
    const nameVeld = nameMatch?.[1]?.trim();
    if (nameVeld !== naam) {
      resultaten.push({
        bestand,
        ok: false,
        fout: `name-veld '${nameVeld ?? '(ontbreekt)'}' komt niet overeen met bestandsnaam '${naam}'`,
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
 * Gebruikt `lstatSync` om symlinks te herkennen zonder ze te volgen, en
 * `readlinkSync` + `existsSync` om te controleren of het doel bereikbaar is.
 */
export function zoekDodeSymlinks(dir: string): string[] {
  const dodeLinks: string[] = [];

  function scan(map: string): void {
    let items: string[];
    try {
      items = readdirSync(map);
    } catch {
      // Map niet leesbaar — overslaan (geen fout, kan door permissies komen).
      return;
    }

    for (const item of items) {
      const volledigPad = path.join(map, item);
      const stat = lstatSync(volledigPad);

      if (stat.isSymbolicLink()) {
        // Resoleer het doel relatief aan de map waar de symlink staat.
        const doel = readlinkSync(volledigPad);
        const absoluutDoel = path.isAbsolute(doel)
          ? doel
          : path.resolve(path.dirname(volledigPad), doel);

        if (!existsSync(absoluutDoel)) {
          dodeLinks.push(volledigPad);
          // Niet recursief in een dode symlink stappen.
          continue;
        }
      }

      // Recursief afdalen: echte directories altijd, symlinks naar directories ook
      // (de dode symlinks zijn hierboven al afgevangen via de continue).
      // readdirSync op iets dat geen map is gooit, wat de try/catch hierboven vangt.
      if (stat.isDirectory()) {
        scan(volledigPad);
      } else if (stat.isSymbolicLink()) {
        // De symlink is levend (anders hadden we gecontinued). Daal af als het
        // doel een directory is — readdirSync faalt anders vanzelf in de try/catch.
        scan(volledigPad);
      }
    }
  }

  scan(dir);
  return dodeLinks;
}
