import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import { claudeCommandsDir, hooksDir, skillsDir, workflowsDir } from '../paths.js';
import { GebruikersFout, git, kop, ok, waarschuwing } from '../shell.js';
/**
 * Een spiegel: een bronmap in de factory en de plek in de app-repo waar hij
 * gelijk aan moet staan. De factory bezit deze plekken volledig, dus een bestand
 * dat hier in de app staat maar niet in de factory, is drift.
 */
function syncSpiegels() {
    return [
        { bronDir: claudeCommandsDir, doelBasis: path.join('.claude', 'commands') },
        { bronDir: skillsDir, doelBasis: path.join('.claude', 'skills') },
        { bronDir: workflowsDir, doelBasis: path.join('.github', 'workflows') },
        { bronDir: hooksDir, doelBasis: '.githooks' },
    ];
}
/** Alle bestandspaden onder een map, relatief aan die map. Leeg als de map ontbreekt. */
function bestandenOnder(dir) {
    if (!existsSync(dir))
        return [];
    const gevonden = [];
    for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory()) {
            for (const sub of bestandenOnder(path.join(dir, item.name))) {
                gevonden.push(path.join(item.name, sub));
            }
        }
        else {
            gevonden.push(item.name);
        }
    }
    return gevonden;
}
function kopieerAlsAnders(bron, doel) {
    if (existsSync(doel) && readFileSync(bron, 'utf8') === readFileSync(doel, 'utf8')) {
        return false;
    }
    mkdirSync(path.dirname(doel), { recursive: true });
    copyFileSync(bron, doel);
    return true;
}
/**
 * Bepaalt per bestand of de app gelijk is aan de factory, ervan afwijkt of een
 * overbodig bestand heeft — zónder iets te schrijven. Paden in `negeer` (relatief
 * aan de app-map) tellen niet mee, zodat een bewuste afwijking geen valse drift is.
 */
export function syncVerschillen(appDir, negeer = []) {
    const genegeerd = (pad) => negeer.some((n) => pad === n || pad.startsWith(`${n}${path.sep}`));
    const verschillen = [];
    for (const { bronDir, doelBasis } of syncSpiegels()) {
        const bronBestanden = bestandenOnder(bronDir);
        const bronSet = new Set(bronBestanden);
        // Factory → app: elk factory-bestand is gelijk of wijkt af (ontbrekend telt als afwijkend).
        for (const rel of bronBestanden) {
            const pad = path.join(doelBasis, rel);
            if (genegeerd(pad))
                continue;
            const doel = path.join(appDir, pad);
            const gelijk = existsSync(doel) &&
                readFileSync(path.join(bronDir, rel), 'utf8') === readFileSync(doel, 'utf8');
            verschillen.push({ pad, status: gelijk ? 'gelijk' : 'afwijkend' });
        }
        // App → factory: een bestand op deze plek dat de factory niet (meer) kent, is overbodig.
        for (const rel of bestandenOnder(path.join(appDir, doelBasis))) {
            if (bronSet.has(rel))
                continue;
            const pad = path.join(doelBasis, rel);
            if (genegeerd(pad))
                continue;
            verschillen.push({ pad, status: 'overbodig' });
        }
    }
    return verschillen;
}
/**
 * Zet de bestanden die de factory aanlevert maar die in de app-repo moeten staan
 * gelijk aan de versie uit het pakket: de slash commands, de skills, de git hook
 * en de CI-workflow. Deze kunnen niet uit node_modules komen omdat Claude Code,
 * git en GitHub Actions ze op een vaste plek in de repo verwachten.
 */
export function syncNaarApp(appDir) {
    const bijgewerkt = [];
    for (const { bronDir, doelBasis } of syncSpiegels()) {
        for (const rel of bestandenOnder(bronDir)) {
            if (kopieerAlsAnders(path.join(bronDir, rel), path.join(appDir, doelBasis, rel))) {
                bijgewerkt.push(path.join(doelBasis, rel));
            }
        }
    }
    // De hook moet uitvoerbaar zijn en git moet hem via .githooks vinden.
    chmodSync(path.join(appDir, '.githooks', 'pre-commit'), 0o755);
    git(['config', 'core.hooksPath', '.githooks'], appDir);
    return bijgewerkt;
}
function tekenVoor(status) {
    switch (status) {
        case 'gelijk':
            return '\x1b[32m  ✓';
        case 'afwijkend':
            return '\x1b[31m  ✗';
        case 'overbodig':
            return '\x1b[31m  ✗';
    }
}
function omschrijving(verschil) {
    switch (verschil.status) {
        case 'gelijk':
            return verschil.pad;
        case 'afwijkend':
            return `${verschil.pad} wijkt af`;
        case 'overbodig':
            return `${verschil.pad} staat in de app maar niet in de factory`;
    }
}
function controleer(appDir) {
    kop('Controleren of de app gelijk is aan de factory');
    const negeer = leesAppConfig(appDir).syncNegeer ?? [];
    const verschillen = syncVerschillen(appDir, negeer);
    const drift = verschillen.filter((verschil) => verschil.status !== 'gelijk');
    if (drift.length === 0) {
        ok('alles gelijk');
        return;
    }
    for (const verschil of verschillen) {
        process.stdout.write(`${tekenVoor(verschil.status)} ${omschrijving(verschil)}\x1b[0m\n`);
    }
    throw new GebruikersFout(`${String(drift.length)} verschil(len) — draai \`factory sync\` om gelijk te trekken`);
}
export function sync(opties = {}) {
    const appDir = zoekAppDir();
    if (appDir === undefined) {
        throw new GebruikersFout('factory sync hoort in een applicatiemap te draaien.');
    }
    if (opties.check === true) {
        controleer(appDir);
        return;
    }
    kop('Slash commands, skills, git hook en CI-workflow gelijkzetten');
    const bijgewerkt = syncNaarApp(appDir);
    if (bijgewerkt.length === 0) {
        waarschuwing('Niets te doen: alles staat al gelijk aan de factory.');
        return;
    }
    for (const bestand of bijgewerkt) {
        process.stdout.write(`  bijgewerkt: ${bestand}\n`);
    }
    ok(`${String(bijgewerkt.length)} bestand(en) bijgewerkt`);
}
//# sourceMappingURL=sync.js.map