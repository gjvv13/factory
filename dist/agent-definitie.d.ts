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
export declare function leesAgentGrenzen(naam: string): AgentGrenzen;
/**
 * Voegt een patroon toe aan `allowedTools` in het frontmatter van een agent-definitie.
 *
 * Een dubbele toevoeging is een no-op: als het patroon er al staat, wordt het bestand
 * niet aangeraakt. Gooit bij een onbekend agent-bestand of ontbrekend frontmatter.
 */
export declare function voegToolToe(agent: string, patroon: string): void;
