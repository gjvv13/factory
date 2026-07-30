import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { zoekAppDir } from '../app-config.js';
import { claudeCommandsDir, hooksDir } from '../paths.js';
import { GebruikersFout, git, kop, ok, waarschuwing } from '../shell.js';
function kopieerAlsAnders(bron, doel) {
    if (existsSync(doel) && readFileSync(bron, 'utf8') === readFileSync(doel, 'utf8')) {
        return false;
    }
    mkdirSync(path.dirname(doel), { recursive: true });
    copyFileSync(bron, doel);
    return true;
}
/**
 * Zet de bestanden die de factory aanlevert maar die in de app-repo moeten
 * staan gelijk aan de versie uit het pakket: de slash commands en de git hook.
 * Deze kunnen niet uit node_modules komen omdat Claude Code en git ze op een
 * vaste plek in de repo verwachten.
 */
export function syncNaarApp(appDir) {
    const bijgewerkt = [];
    for (const bestand of readdirSync(claudeCommandsDir)) {
        const doel = path.join(appDir, '.claude', 'commands', bestand);
        if (kopieerAlsAnders(path.join(claudeCommandsDir, bestand), doel)) {
            bijgewerkt.push(path.join('.claude', 'commands', bestand));
        }
    }
    const hookDoel = path.join(appDir, '.githooks', 'pre-commit');
    if (kopieerAlsAnders(path.join(hooksDir, 'pre-commit'), hookDoel)) {
        bijgewerkt.push(path.join('.githooks', 'pre-commit'));
    }
    chmodSync(hookDoel, 0o755);
    git(['config', 'core.hooksPath', '.githooks'], appDir);
    return bijgewerkt;
}
export function sync() {
    const appDir = zoekAppDir();
    if (appDir === undefined) {
        throw new GebruikersFout('factory sync hoort in een applicatiemap te draaien.');
    }
    kop('Slash commands en git hook gelijkzetten');
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