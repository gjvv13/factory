import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
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
    return { code: resultaat.status ?? 1, stdout: resultaat.stdout, stderr: resultaat.stderr };
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
    return { code: uitkomst.code, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
}
/**
 * Herkent de signatuur van een tijdelijke DNS-storing naar een externe host — de
 * blip die af en toe `git push` (ssh) of `pnpm install` (https) laat mislukken.
 * Bewust strak op de bekende strings, zodat een échte fout (auth, non-fast-forward,
 * merge-conflict) níet als vergeeflijk telt en meteen naar boven komt.
 */
/**
 * Zet een uitvoer-variabele klaar voor de omliggende GitHub-workflow; buiten een
 * workflow doet dit niets.
 *
 * Waarom de CLI dit zelf schrijft en de workflow het niet uit de uitvoer vist (zoals
 * `heeft-migratie` doet): dit gaat niet om één waarde maar om een gegeven dat midden in
 * een log met menselijke regels ontstaat. Dat er met `tail` uit halen is fragiel — de
 * schrijver weet het gewoon.
 */
export function schrijfWorkflowUitvoer(naam, waarde) {
    const doel = process.env['GITHUB_OUTPUT'];
    if (doel === undefined || doel === '') {
        return;
    }
    appendFileSync(doel, `${naam}=${waarde}\n`);
}
export function isDnsBlip(tekst) {
    return /could not resolve host|nodename nor servname|temporary failure in name resolution|getaddrinfo (?:ENOTFOUND|EAI_AGAIN)/i.test(tekst);
}
const echteWacht = (ms) => {
    // Synchrone slaap: run() is synchroon (spawnSync), dus de backoff kan geen await
    // gebruiken. Atomics.wait blokkeert deze thread zonder te pollen. In een CLI is
    // even blokkeren prima; tests vervangen dit door een no-op.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
let huidigeWacht = echteWacht;
/** Vervangt de backoff-slaap. Alleen bedoeld voor tests. */
export function stelWachtIn(wacht) {
    huidigeWacht = wacht;
}
/** Herstelt de echte backoff-slaap na een test. */
export function herstelWacht() {
    huidigeWacht = echteWacht;
}
/**
 * Voert een commando uit en herhaalt het bij een tijdelijke DNS-storing, met
 * oplopende backoff. Alleen die klasse fout wordt herhaald: elke andere non-nul
 * uitkomst valt terug op het normale run()-gedrag (fout naar boven, tenzij
 * `toleranter`). Blijft de storing aanhouden, dan faalt de laatste poging met de
 * echte fout. De uitvoer wordt gevangen om stderr te kunnen inspecteren en bij een
 * echte fout alsnog doorgegeven, zodat de aanroeper niets aan zichtbaarheid inlevert.
 */
export function runMetHerhaling(commando, argumenten, options = {}, herhaal = {}) {
    const pogingen = herhaal.pogingen ?? 3;
    const backoffMs = herhaal.backoffMs ?? 1000;
    const wat = herhaal.wat ?? commando;
    for (let poging = 1;; poging += 1) {
        const uitkomst = huidigeUitvoerder(commando, argumenten, { ...options, capture: true });
        if (uitkomst.startfout !== undefined) {
            throw new GebruikersFout(`Kon '${commando}' niet uitvoeren: ${uitkomst.startfout}`);
        }
        if (uitkomst.code === 0) {
            return { code: 0, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
        }
        const uitvoer = `${uitkomst.stdout}\n${uitkomst.stderr ?? ''}`;
        if (isDnsBlip(uitvoer) && poging < pogingen) {
            const wachtMs = backoffMs * 2 ** (poging - 1);
            waarschuwing(`${wat} faalde op een tijdelijke DNS-storing (poging ${String(poging)}/${String(pogingen)}), opnieuw over ${String(Math.round(wachtMs / 1000))}s…`);
            huidigeWacht(wachtMs);
            continue;
        }
        // Geen blip, of de pogingen zijn op: terug naar het normale run()-gedrag. We
        // gaven capture geforceerd aan, dus geef de opgevangen uitvoer alsnog door zodat
        // de echte fout zichtbaar is.
        if (options.toleranter === true) {
            return { code: uitkomst.code, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
        }
        if (uitkomst.stdout !== '')
            process.stdout.write(uitkomst.stdout);
        if ((uitkomst.stderr ?? '') !== '')
            process.stderr.write(uitkomst.stderr ?? '');
        throw new GebruikersFout(`'${commando} ${argumenten.join(' ')}' faalde met code ${String(uitkomst.code)}`);
    }
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
export function draaiScript(script, cwd, env) {
    const { commando, basisArgumenten } = pakketbeheerder();
    run(commando, [...basisArgumenten, 'run', script], {
        cwd,
        ...(env === undefined ? {} : { env }),
    });
}
/** Of er een terminal aan stdin hangt, zodat we de gebruiker iets kunnen vragen. */
export function isInteractief() {
    return process.stdin.isTTY;
}
/**
 * Stelt een ja/nee-vraag en geeft true bij 'j' of 'ja' (hoofdletterongevoelig);
 * al het andere, ook enter, is nee. De streams zijn injecteerbaar zodat de vraag
 * getest kan worden zonder een echte terminal.
 */
export async function bevestig(vraag, io = {}) {
    const rl = createInterface({
        input: io.input ?? process.stdin,
        output: io.output ?? process.stdout,
    });
    try {
        const antwoord = await rl.question(`${vraag} [j/N] `);
        return /^ja?$/i.test(antwoord.trim());
    }
    finally {
        rl.close();
    }
}
const spawnStarter = (commando, argumenten, options) => {
    const kind = spawn(commando, argumenten, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'ignore',
    });
    return {
        kill: () => {
            kind.kill();
        },
    };
};
let huidigeStarter = spawnStarter;
/** Vervangt de proces-starter. Alleen bedoeld voor tests. */
export function stelStarterIn(starter) {
    huidigeStarter = starter;
}
/** Herstelt de echte proces-starter na een test. */
export function herstelStarter() {
    huidigeStarter = spawnStarter;
}
/** Vraagt het besturingssysteem om een vrije poort op de loopback. */
export function vrijePoort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const adres = server.address();
            const poort = typeof adres === 'object' && adres !== null ? adres.port : 0;
            server.close(() => {
                resolve(poort);
            });
        });
    });
}
/**
 * Start een commando, wacht tot de health-URL gezond antwoordt, en stopt het
 * proces daarna weer. Geeft terug of het binnen de tijd gezond werd. Zo kan een
 * nieuwe versie gecontroleerd worden vóórdat een draaiende omgeving wordt
 * aangeraakt.
 */
export async function isGezondNaStart(opstart, healthUrl, seconden) {
    const proces = huidigeStarter(opstart.commando, opstart.argumenten, {
        cwd: opstart.cwd,
        env: opstart.env,
    });
    try {
        for (let poging = 0; poging < seconden; poging += 1) {
            try {
                const antwoord = await fetch(healthUrl);
                if (antwoord.ok) {
                    return true;
                }
            }
            catch {
                // Nog niet opgekomen; volgende poging.
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return false;
    }
    finally {
        proces.kill();
    }
}
/**
 * Poll een health-URL tot hij gezond antwoordt. Geeft de responstekst terug, of
 * undefined als het binnen de tijd niet lukt. Throwt niet, zodat de aanroeper zelf
 * kan beslissen wat een falende gezondheid betekent (bijv. terugrollen).
 */
export async function wachtOpGezond(url, seconden) {
    for (let poging = 0; poging < seconden; poging += 1) {
        try {
            const antwoord = await fetch(url);
            if (antwoord.ok) {
                return await antwoord.text();
            }
        }
        catch {
            // Nog niet op; volgende poging.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return undefined;
}
//# sourceMappingURL=shell.js.map