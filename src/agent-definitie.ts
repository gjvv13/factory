import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { agentsDir } from './paths.js';

/**
 * De uit een agent-definitie gelezen grenzen: de tool-lijsten en het model.
 *
 * `claude --agent <naam>` ontdekt de agent aan het `name:`-veld en leest er het
 * rol-systeemprompt (de body) uit, maar het subagent-formaat kan géén fijnmazige
 * `Bash(git push:*)`-verboden uitdrukken. Die grens borgen we daarom expliciet:
 * de factory leest `allowedTools`/`disallowedTools` uit het frontmatter en geeft
 * ze als `--allowedTools`/`--disallowedTools` aan `claude` mee (#547). Zo blijft
 * de definitie de enige bron van waarheid én blijft de grens hard.
 */
export interface AgentGrenzen {
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
  readonly model: string | undefined;
}

/**
 * Leest het YAML-frontmatter uit een agent-definitie en haalt de tool-lijsten en
 * het model eruit. Geen YAML-parser nodig: het frontmatter bevat alleen eenvoudige
 * `key:`- en `  - "waarde"`-patronen.
 */
export function leesAgentGrenzen(naam: string): AgentGrenzen {
  const inhoud = readFileSync(path.join(agentsDir, `${naam}.md`), 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(inhoud);
  if (match?.[1] === undefined) throw new Error(`Geen frontmatter in agents/${naam}.md`);
  const frontmatter = match[1];

  /** Haalt een YAML-array op: items staan als `  - "waarde"` of `  - waarde`. */
  function leesLijst(sleutel: string): string[] {
    // Het blok begint bij `key:` en loopt tot de volgende top-level key of het
    // einde: alle regels die na de header met whitespace beginnen. JavaScript kent
    // geen `\Z`, dus matchen we op die ingesprongen regels.
    const regex = new RegExp(`^${sleutel}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm');
    const blok = regex.exec(frontmatter)?.[1] ?? '';
    return [...blok.matchAll(/^\s+-\s+['"]?([^'"\n]+)['"]?\s*$/gm)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
  }

  const modelMatch = /^model:\s*(.+)$/m.exec(frontmatter);

  return {
    allowedTools: leesLijst('allowedTools'),
    disallowedTools: leesLijst('disallowedTools'),
    model: modelMatch?.[1]?.trim(),
  };
}

/**
 * Voegt een patroon toe aan `allowedTools` in het frontmatter van een agent-definitie.
 *
 * Een dubbele toevoeging is een no-op: als het patroon er al staat, wordt het bestand
 * niet aangeraakt. Gooit bij een onbekend agent-bestand of ontbrekend frontmatter.
 */
export function voegToolToe(agent: string, patroon: string): void {
  const bestandsPad = path.join(agentsDir, `${agent}.md`);
  const inhoud = readFileSync(bestandsPad, 'utf8');

  // Controleer of het patroon al in de allowedTools staat.
  const bestaand = leesAgentGrenzen(agent);
  if (bestaand.allowedTools.includes(patroon)) {
    return;
  }

  // Zoek het einde van het allowedTools-blok: de laatste `  - '...'`-regel vóór de
  // volgende top-level key of het einde van het frontmatter.
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(inhoud);
  if (frontmatterMatch?.[1] === undefined) {
    throw new Error(`Geen frontmatter in agents/${agent}.md`);
  }

  // Strategie: zoek de laatste regel van het allowedTools-blok en voeg erna toe.
  // Het blok begint bij `allowedTools:` en alle regels die beginnen met `  - ` horen
  // erbij, tot de eerste regel die niet met whitespace begint (de volgende key).
  const regels = inhoud.split('\n');
  let laatsteToolRegel = -1;
  let inAllowedTools = false;

  for (let i = 0; i < regels.length; i++) {
    const regel = regels[i] ?? '';
    if (regel.startsWith('allowedTools:')) {
      inAllowedTools = true;
      continue;
    }
    if (inAllowedTools) {
      if (/^\s+-\s/.test(regel)) {
        laatsteToolRegel = i;
      } else {
        // Volgende top-level key of einde blok.
        break;
      }
    }
  }

  if (laatsteToolRegel === -1) {
    throw new Error(`Geen allowedTools-items gevonden in agents/${agent}.md`);
  }

  // Voeg het nieuwe patroon toe na de laatste bestaande regel.
  regels.splice(laatsteToolRegel + 1, 0, `  - '${patroon}'`);
  writeFileSync(bestandsPad, regels.join('\n'));
}
