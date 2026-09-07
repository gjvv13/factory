/**
 * Eén geweigerd gereedschap uit het sessielog: welke tool, welk commando en hoe vaak.
 *
 * Het sessielog is een intern Claude Code formaat dat niet gedocumenteerd is en kan
 * veranderen bij een update. De terugval: bij elk faalscenario een leeg resultaat en
 * een waarschuwing, nooit een crash (#542).
 */
export interface SessieWeigering {
    readonly tool: string;
    readonly commando?: string;
    readonly aantal: number;
}
/**
 * Leest het Claude Code sessielog voor een gegeven sessie-id en werkmap, en extraheert
 * de permission denials.
 *
 * Het pad wordt afgeleid uit de werkmap: `/` → `-`, als project-mapnaam onder
 * `~/.claude/projects/`. De sessie-id is de bestandsnaam (zonder `.jsonl`).
 *
 * Elk faalscenario — pad niet gevonden, JSONL onleesbaar, onbekende entry-structuur —
 * geeft een leeg array terug en logt een waarschuwing. Geen crash, geen rode poort.
 */
export declare function leesWeigeringenUitLog(sessieId: string, werkmap: string): readonly SessieWeigering[];
