import { readFileSync } from 'node:fs';
import path from 'node:path';
import { agentsDir } from './paths.js';
/**
 * Leest het YAML-frontmatter uit een agent-definitie en haalt de tool-lijsten en
 * het model eruit. Geen YAML-parser nodig: het frontmatter bevat alleen eenvoudige
 * `key:`- en `  - "waarde"`-patronen.
 */
export function leesAgentGrenzen(naam) {
    const inhoud = readFileSync(path.join(agentsDir, `${naam}.md`), 'utf8');
    const match = /^---\n([\s\S]*?)\n---/.exec(inhoud);
    if (match?.[1] === undefined)
        throw new Error(`Geen frontmatter in agents/${naam}.md`);
    const frontmatter = match[1];
    /** Haalt een YAML-array op: items staan als `  - "waarde"` of `  - waarde`. */
    function leesLijst(sleutel) {
        // Het blok begint bij `key:` en loopt tot de volgende top-level key of het
        // einde: alle regels die na de header met whitespace beginnen. JavaScript kent
        // geen `\Z`, dus matchen we op die ingesprongen regels.
        const regex = new RegExp(`^${sleutel}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm');
        const blok = regex.exec(frontmatter)?.[1] ?? '';
        return [...blok.matchAll(/^\s+-\s+['"]?([^'"\n]+)['"]?\s*$/gm)].flatMap((m) => m[1] === undefined ? [] : [m[1]]);
    }
    const modelMatch = /^model:\s*(.+)$/m.exec(frontmatter);
    return {
        allowedTools: leesLijst('allowedTools'),
        disallowedTools: leesLijst('disallowedTools'),
        model: modelMatch?.[1]?.trim(),
    };
}
//# sourceMappingURL=agent-definitie.js.map