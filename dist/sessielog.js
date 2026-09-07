import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { waarschuwing } from './shell.js';
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
export function leesWeigeringenUitLog(sessieId, werkmap) {
    const pad = sessielogPad(sessieId, werkmap);
    if (pad === undefined)
        return [];
    let inhoud;
    try {
        inhoud = readFileSync(pad, 'utf8');
    }
    catch (fout) {
        waarschuwing(`sessielog niet leesbaar: ${pad} — ${fout instanceof Error ? fout.message : String(fout)}`);
        return [];
    }
    if (inhoud.trim() === '')
        return [];
    return parseSessieWeigeringen(inhoud, pad);
}
/**
 * Ontdekt het pad naar het sessielog. Probeert bekende patronen; geen match → `undefined`.
 *
 * Patroon (gemeten 2026-09-07): `~/.claude/projects/<encoded-cwd>/<sessie-id>.jsonl`
 * waarbij `<encoded-cwd>` het absolute pad is met elke `/` vervangen door `-`.
 */
function sessielogPad(sessieId, werkmap) {
    // Patroon 1: werkmap direct encoderen — elke `/` wordt `-`.
    const geencodeerd = werkmap.replaceAll(sep, '-');
    const projectMap = join(homedir(), '.claude', 'projects', geencodeerd);
    const directPad = join(projectMap, `${sessieId}.jsonl`);
    try {
        // Snelle test: bestaat het bestand?
        readFileSync(directPad, { flag: 'r', encoding: 'utf8' }).slice(0, 0);
        return directPad;
    }
    catch {
        // Patroon 2: zoek in alle project-mappen naar het sessie-bestand. Duur, maar dit
        // is de terugval voor een onverwacht pad-patroon.
        try {
            const projectsMap = join(homedir(), '.claude', 'projects');
            for (const dir of readdirSync(projectsMap)) {
                const kandidaat = join(projectsMap, dir, `${sessieId}.jsonl`);
                try {
                    readFileSync(kandidaat, { flag: 'r', encoding: 'utf8' }).slice(0, 0);
                    return kandidaat;
                }
                catch {
                    // Niet in deze map.
                }
            }
        }
        catch {
            // ~/.claude/projects bestaat niet of is onleesbaar.
        }
    }
    waarschuwing(`sessielog niet gevonden voor sessie ${sessieId} in werkmap ${werkmap}`);
    return undefined;
}
/**
 * Parst de JSONL-inhoud en extraheert gegroepeerde weigeringen.
 *
 * Een weigering is een entry met `toolDenialKind` (waarde `permission-rule` of
 * `user-rejected`). De `sourceToolAssistantUUID` verwijst naar de assistant-entry
 * die de tool-aanroep deed; de tool-naam en het commando komen uit de `tool_result`
 * in `message.content`.
 */
function parseSessieWeigeringen(inhoud, pad) {
    const regels = inhoud.trim().split('\n');
    const teller = new Map();
    for (const regel of regels) {
        let entry;
        try {
            entry = JSON.parse(regel);
        }
        catch {
            // Onleesbare regel; sla over, geen crash.
            continue;
        }
        if (!isWeigering(entry))
            continue;
        const tool = extractToolNaam(entry);
        if (tool === undefined)
            continue;
        const commando = extractCommando(entry);
        const sleutel = commando !== undefined ? `${tool}:${commando}` : tool;
        const bestaand = teller.get(sleutel);
        if (bestaand !== undefined) {
            bestaand.aantal++;
        }
        else {
            teller.set(sleutel, { tool, ...(commando !== undefined ? { commando } : {}), aantal: 1 });
        }
    }
    if (teller.size === 0)
        return [];
    const resultaat = [...teller.values()].sort((a, b) => b.aantal - a.aantal);
    // Sanity check: als er weigeringen waren maar we konden niets herkennen, meld dat.
    if (resultaat.length === 0) {
        waarschuwing(`sessielog ${pad} bevat regels maar geen herkenbare weigeringen`);
    }
    return resultaat;
}
/**
 * Herkent een weigering-entry: heeft `toolDenialKind` en `is_error: true` in de
 * tool_result.
 */
function isWeigering(entry) {
    if (typeof entry !== 'object' || entry === null)
        return false;
    const e = entry;
    return typeof e.toolDenialKind === 'string';
}
/**
 * Extraheert de tool-naam uit een weigerings-entry. De `toolUseResult` begint met
 * "Error: Permission to use <tool> has been denied" of de `message.content` bevat
 * de tool_use_id. We parsen de tool-naam uit `toolUseResult`.
 */
function extractToolNaam(entry) {
    const e = entry;
    // Eerst: kijk in message.content naar tool_result naast een tool_use block
    const bericht = e.message;
    if (bericht !== undefined && Array.isArray(bericht.content)) {
        for (const blok of bericht.content) {
            if (typeof blok === 'object' && blok !== null) {
                const b = blok;
                if (b.type === 'tool_result' && typeof b.content === 'string') {
                    // "Permission to use Bash has been denied" of "This command requires approval"
                    const match = /Permission to use (\w+) has been denied/.exec(b.content);
                    if (match?.[1] !== undefined)
                        return match[1];
                }
            }
        }
    }
    // Terugval: uit toolUseResult
    if (typeof e.toolUseResult === 'string') {
        const match = /Permission to use (\w+) has been denied/.exec(e.toolUseResult);
        if (match?.[1] !== undefined)
            return match[1];
    }
    // Laatste redmiddel: als toolDenialKind er is maar we de tool niet herkennen
    return undefined;
}
/**
 * Extraheert het commando uit een Bash-weigering, als het er is.
 */
function extractCommando(entry) {
    const e = entry;
    // Het assistant-bericht met de tool_use bevat het commando in input.command,
    // maar dat zit in een andere entry (sourceToolAssistantUUID). We hebben hier
    // alleen de user-entry met de tool_result. Het commando staat niet in de
    // denial-entry zelf — alleen de tool-naam.
    //
    // Voor "This command requires approval" staat het commando soms in de content:
    if (typeof e.toolUseResult === 'string') {
        // Check of er een commando-hint in zit (komt voor bij sommige denial-vormen)
        // maar dit is niet betrouwbaar genoeg. We laten commando weg als het niet
        // uit de denial zelf te halen is — de envelop heeft het wél.
    }
    return undefined;
}
//# sourceMappingURL=sessielog.js.map