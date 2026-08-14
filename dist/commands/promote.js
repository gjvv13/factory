import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { leesOmgevingsWaarden, pm2NaamVan, vereisAppConfig, werkmapVan, } from '../app-config.js';
import { bevestig, GebruikersFout, git, isGezondNaStart, isInteractief, kop, ok, pakketbeheerder, run, uitvoerVan, vrijePoort, waarschuwing, wachtOpGezond, } from '../shell.js';
import { herstartOmgeving, toonGeladenConfig } from '../env-herstart.js';
function omgevingsVariabelen(appDir, werkmap, omgeving) {
    // De env-bestanden van de omgeving eroverheen, zodat migrate en seed op de
    // juiste database draaien (bijv. DATABASE_FILE=data/prod.sqlite) en niet op de
    // default. ROOT_DIR en FACTORY_ENV dwingen we daarna af, net als de ecosystem.
    return {
        ...process.env,
        ...leesOmgevingsWaarden(appDir, omgeving),
        ROOT_DIR: werkmap,
        FACTORY_ENV: omgeving,
    };
}
export async function promote(omgevingArgument, tagArgument, opties = {}) {
    if (omgevingArgument !== 'acc' && omgevingArgument !== 'prod') {
        throw new GebruikersFout('Gebruik: factory promote <acc|prod> [tag]');
    }
    const omgeving = omgevingArgument;
    // Prod vraagt bevestiging. Kan die niet gesteld worden (geen terminal) en is er
    // ook geen --ja, dan stoppen we meteen, vóór er iets aan de omgeving gebeurt.
    const vraagtBevestiging = omgeving === 'prod' && opties.ja !== true;
    if (vraagtBevestiging && !isInteractief()) {
        throw new GebruikersFout('Prod omzetten vraagt bevestiging. Draai je dit niet-interactief (CI), geef dan --ja mee.');
    }
    const config = vereisAppConfig();
    const repoDir = config.appDir;
    const tag = tagArgument ??
        uitvoerVan('git', ['tag', '--sort=-v:refname'], repoDir)?.split('\n')[0]?.trim() ??
        '';
    if (tag === '') {
        throw new GebruikersFout('Geen tag gevonden. Maak eerst een release met: factory release');
    }
    if (uitvoerVan('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], repoDir) === undefined) {
        throw new GebruikersFout(`Tag '${tag}' bestaat niet.`);
    }
    const werkmap = werkmapVan(config, omgeving);
    const poort = config.poorten[omgeving];
    const pm2Naam = pm2NaamVan(config, omgeving);
    kop(`Promoveren van ${tag} naar ${omgeving} (${config.naam})`);
    if (!existsSync(path.join(werkmap, '.git'))) {
        // Bewust `git init` en geen `git clone`: de map kan al bestaan met een
        // database van een eerdere versie erin, en die mag een herdeploy niet blokkeren.
        kop(`Werkmap voor ${omgeving} inrichten in ${werkmap}`);
        mkdirSync(werkmap, { recursive: true });
        run('git', ['init', '-q', werkmap]);
    }
    // Onthoud welke tag er nu draait, vóór we de nieuwe uitchecken. Bij een falende
    // deploy rollen we hierop terug. Undefined bij een eerste deploy: dan is er niets
    // om op terug te vallen.
    const vorigeTag = uitvoerVan('git', ['describe', '--tags'], werkmap);
    kop('Tag uitchecken');
    const remotes = (uitvoerVan('git', ['remote'], werkmap) ?? '').split('\n').filter(Boolean);
    git(['remote', remotes.includes('origin') ? 'set-url' : 'add', 'origin', repoDir], werkmap);
    git(['fetch', '-q', '--tags', 'origin'], werkmap);
    git(['checkout', '-q', '--detach', tag], werkmap);
    // `*.secrets.env` wordt uitgesloten: dat bestand hoort niet in git (tokens,
    // sleutels) en staat alleen in de werkmap. Zonder deze uitsluiting wist elke
    // promote de secrets, waarna een verse start de omgeving niet meer kan opbouwen.
    git(['clean', '-qfd', '-e', 'data', '-e', 'logs', '-e', 'node_modules', '-e', '*.secrets.env'], werkmap);
    ok(uitvoerVan('git', ['describe', '--tags'], werkmap) ?? tag);
    const { commando, basisArgumenten } = pakketbeheerder();
    kop('Afhankelijkheden installeren');
    run(commando, [...basisArgumenten, 'install', '--frozen-lockfile', '--prod=false'], {
        cwd: werkmap,
        capture: true,
    });
    kop('Bouwen');
    run(commando, [...basisArgumenten, 'run', 'build'], { cwd: werkmap, capture: true });
    kop('Database migreren');
    run(commando, [...basisArgumenten, 'run', 'migrate'], {
        cwd: werkmap,
        env: omgevingsVariabelen(repoDir, werkmap, omgeving),
    });
    if (omgeving === 'acc') {
        kop('Testdata inlezen op acceptatie');
        run(commando, [...basisArgumenten, 'run', 'seed'], {
            cwd: werkmap,
            env: omgevingsVariabelen(repoDir, werkmap, omgeving),
        });
    }
    // Pre-swap: start de nieuwe versie kort op een vrije poort en controleer dat hij
    // gezond opkomt vóór we het draaiende proces aanraken. Vangt opstart- en
    // config-fouten (bijv. strengere validatie) af terwijl de omgeving nog draait.
    kop('Controle vooraf op een tijdelijke poort');
    const controlePoort = await vrijePoort();
    const voorafGezond = await isGezondNaStart({
        commando: 'node',
        argumenten: ['dist/main.js'],
        cwd: werkmap,
        env: {
            ...omgevingsVariabelen(repoDir, werkmap, omgeving),
            PORT: String(controlePoort),
            HOST: '127.0.0.1',
        },
    }, `http://127.0.0.1:${String(controlePoort)}/health`, 15);
    if (!voorafGezond) {
        throw new GebruikersFout(`De nieuwe versie werd niet gezond op een tijdelijke poort; ${omgeving} is niet aangeraakt.`);
    }
    ok('nieuwe versie komt gezond op');
    if (vraagtBevestiging && !(await bevestig(`Prod omzetten naar ${tag}?`))) {
        throw new GebruikersFout('Afgebroken: prod is niet omgezet.');
    }
    kop('Omgeving herstarten');
    mkdirSync(path.join(repoDir, 'logs'), { recursive: true });
    const ecosystem = path.join(repoDir, 'environments', 'ecosystem.config.cjs');
    herstartOmgeving(ecosystem, pm2Naam);
    toonGeladenConfig(repoDir, omgeving);
    const healthUrl = `http://127.0.0.1:${String(poort)}/health`;
    kop(`Controleren of ${omgeving} leeft`);
    const gezondheid = await wachtOpGezond(healthUrl, 30);
    if (gezondheid !== undefined) {
        ok(`${omgeving} is gezond: ${gezondheid}`);
        return;
    }
    // Post-swap health faalt: de nieuwe versie draait maar komt niet gezond op. Rol
    // het proces terug naar de vorige tag. Migraties draaien we niet terug — het
    // oude proces draait dus tegen een mogelijk nieuwer schema; dat melden we.
    if (vorigeTag === undefined) {
        throw new GebruikersFout(`${tag} werd niet gezond en er is geen vorige versie om naar terug te rollen; ${omgeving} draait mogelijk niet. Handmatig ingrijpen nodig.`);
    }
    waarschuwing(`Terugrollen naar ${vorigeTag}`);
    git(['checkout', '-q', '--detach', vorigeTag], werkmap);
    git(['clean', '-qfd', '-e', 'data', '-e', 'logs', '-e', 'node_modules', '-e', '*.secrets.env'], werkmap);
    run(commando, [...basisArgumenten, 'install', '--frozen-lockfile', '--prod=false'], {
        cwd: werkmap,
        capture: true,
    });
    run(commando, [...basisArgumenten, 'run', 'build'], { cwd: werkmap, capture: true });
    herstartOmgeving(ecosystem, pm2Naam);
    if ((await wachtOpGezond(healthUrl, 30)) === undefined) {
        throw new GebruikersFout(`Terugrollen naar ${vorigeTag} lukte niet; ${omgeving} is niet gezond. Handmatig ingrijpen nodig.`);
    }
    throw new GebruikersFout(`Afgebroken: ${tag} werd niet gezond. ${omgeving} draait weer op ${vorigeTag}. Let op: migraties zijn niet teruggedraaid.`);
}
//# sourceMappingURL=promote.js.map