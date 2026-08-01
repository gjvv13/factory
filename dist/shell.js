import { spawnSync } from 'node:child_process';
export function kop(tekst) {
    process.stdout.write(`\n\x1b[1m==> ${tekst}\x1b[0m\n`);
}
export function ok(tekst) {
    process.stdout.write(`\x1b[32m✓ ${tekst}\x1b[0m\n`);
}
export function waarschuwing(tekst) {
    process.stdout.write(`\x1b[33m! ${tekst}\x1b[0m\n`);
}
export function fout(tekst) {
    process.stderr.write(`\x1b[31m✗ ${tekst}\x1b[0m\n`);
}
/** Fout waarbij de melding al genoeg is: de CLI print hem en stopt met code 1. */
export class GebruikersFout extends Error {
    constructor(message) {
        super(message);
        this.name = 'GebruikersFout';
    }
}
const spawnUitvoerder = (commando, argumenten, options) => {
    const resultaat = spawnSync(commando, argumenten, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
        encoding: 'utf8',
    });
    if (resultaat.error !== undefined) {
        return { code: 1, stdout: '', startfout: resultaat.error.message };
    }
    return { code: resultaat.status ?? 1, stdout: resultaat.stdout };
};
let huidigeUitvoerder = spawnUitvoerder;
/** Vervangt de proces-uitvoerder. Alleen bedoeld voor tests. */
export function stelUitvoerderIn(uitvoerder) {
    huidigeUitvoerder = uitvoerder;
}
/** Herstelt de echte proces-uitvoerder na een test. */
export function herstelUitvoerder() {
    huidigeUitvoerder = spawnUitvoerder;
}
/**
 * Voert een commando uit. Stdin staat standaard dicht: de pipeline is niet
 * interactief en mag nooit op invoer blijven wachten.
 */
export function run(commando, argumenten, options = {}) {
    const uitkomst = huidigeUitvoerder(commando, argumenten, options);
    if (uitkomst.startfout !== undefined) {
        throw new GebruikersFout(`Kon '${commando}' niet uitvoeren: ${uitkomst.startfout}`);
    }
    if (uitkomst.code !== 0 && options.toleranter !== true) {
        throw new GebruikersFout(`'${commando} ${argumenten.join(' ')}' faalde met code ${String(uitkomst.code)}`);
    }
    return { code: uitkomst.code, stdout: uitkomst.stdout };
}
export function git(argumenten, cwd, options = {}) {
    return run('git', argumenten, { ...options, cwd });
}
/** Uitvoer van een commando als getrimde tekst, of undefined als het faalt. */
export function uitvoerVan(commando, argumenten, cwd) {
    const resultaat = run(commando, argumenten, {
        ...(cwd === undefined ? {} : { cwd }),
        capture: true,
        toleranter: true,
    });
    return resultaat.code === 0 ? resultaat.stdout.trim() : undefined;
}
/**
 * De pakketbeheerder waarmee scripts gedraaid worden. pnpm komt via corepack,
 * dus in een niet-interactieve shell staat hij niet altijd los in de PATH.
 */
export function pakketbeheerder() {
    const heeftPnpm = spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0;
    return heeftPnpm
        ? { commando: 'pnpm', basisArgumenten: [] }
        : { commando: 'corepack', basisArgumenten: ['pnpm'] };
}
export function draaiScript(script, cwd) {
    const { commando, basisArgumenten } = pakketbeheerder();
    run(commando, [...basisArgumenten, 'run', script], { cwd });
}
//# sourceMappingURL=shell.js.map