import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_CONFIG_BESTAND, leesAppConfig } from '../app-config.js';
import { factoryPakketDir, skeletonDir } from '../paths.js';
import { GebruikersFout, git, kop, ok, run } from '../shell.js';
import { syncNaarApp } from './sync.js';
/** Eerste poort van een blok; prod = basis, dev = basis + 1, acc = basis + 2. */
const EERSTE_BLOK = 3000;
const BLOKGROOTTE = 10;
const TEKSTEXTENSIES = new Set([
    '.ts',
    '.js',
    '.cjs',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.env',
    '.sql',
    '',
]);
function vereisFactoryRepo() {
    const repoDir = process.cwd();
    if (!existsSync(path.join(repoDir, 'skeleton'))) {
        throw new GebruikersFout('factory nieuw hoort in de factory-repo te draaien: daar staat het skeleton.');
    }
    return repoDir;
}
/** Zoekt het eerstvolgende vrije poortblok door de zusterapplicaties te bekijken. */
function kiesPoortBlok(werkruimte) {
    const bezet = new Set();
    for (const item of readdirSync(werkruimte, { withFileTypes: true })) {
        if (!item.isDirectory())
            continue;
        const configPad = path.join(werkruimte, item.name, APP_CONFIG_BESTAND);
        if (!existsSync(configPad))
            continue;
        try {
            const config = leesAppConfig(path.join(werkruimte, item.name));
            for (const poort of Object.values(config.poorten)) {
                bezet.add(poort);
            }
        }
        catch {
            // Een onleesbare factory.json van een andere app mag dit niet blokkeren.
        }
    }
    for (let basis = EERSTE_BLOK; basis < 65_000; basis += BLOKGROOTTE) {
        if (![basis, basis + 1, basis + 2].some((poort) => bezet.has(poort))) {
            return basis;
        }
    }
    throw new GebruikersFout('Geen vrij poortblok gevonden.');
}
function vervangTokens(dir, tokens) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
        const pad = path.join(dir, item.name);
        if (item.isDirectory()) {
            vervangTokens(pad, tokens);
            continue;
        }
        if (!TEKSTEXTENSIES.has(path.extname(item.name)))
            continue;
        const origineel = readFileSync(pad, 'utf8');
        let bijgewerkt = origineel;
        for (const [token, waarde] of Object.entries(tokens)) {
            bijgewerkt = bijgewerkt.split(token).join(waarde);
        }
        if (bijgewerkt !== origineel) {
            writeFileSync(pad, bijgewerkt);
        }
    }
}
function factoryVersie() {
    const inhoud = JSON.parse(readFileSync(path.join(factoryPakketDir, 'package.json'), 'utf8'));
    const versie = typeof inhoud === 'object' && inhoud !== null && 'version' in inhoud
        ? inhoud.version
        : undefined;
    return typeof versie === 'string' ? versie : '1.0.0';
}
/** Zet een nieuwe applicatie op basis van het skeleton, met een eigen poortblok. */
export function nieuw(naam, opties = {}) {
    if (naam === undefined || !/^[a-z][a-z0-9-]*$/.test(naam)) {
        throw new GebruikersFout('Gebruik: factory nieuw <naam> — kleine letters, cijfers en streepjes, beginnend met een letter.');
    }
    const factoryRepo = vereisFactoryRepo();
    const werkruimte = path.dirname(factoryRepo);
    const appDir = path.join(werkruimte, naam);
    if (existsSync(appDir)) {
        throw new GebruikersFout(`${appDir} bestaat al.`);
    }
    const basis = kiesPoortBlok(werkruimte);
    const poorten = { prod: basis, dev: basis + 1, acc: basis + 2 };
    kop(`Applicatie '${naam}' aanmaken in ${appDir}`);
    cpSync(skeletonDir, appDir, { recursive: true });
    // Dubbele accolades en niet __TOKEN__: dat laatste leest markdown als vetgedrukt,
    // waardoor prettier de placeholder in het skeleton zou omschrijven.
    vervangTokens(appDir, {
        '{{APP_NAAM}}': naam,
        '{{PORT_DEV}}': String(poorten.dev),
        '{{PORT_ACC}}': String(poorten.acc),
        '{{PORT_PROD}}': String(poorten.prod),
        // Expliciet git+https en niet de github:-verkorting: die laatste zet pnpm
        // in de lockfile om naar een ssh-URL, en dan heeft een CI-runner een
        // sleutel nodig om de factory te kunnen ophalen.
        '{{FACTORY_DEP}}': opties.link === true
            ? 'link:../factory'
            : `git+https://github.com/gjvv13/factory.git#v${factoryVersie()}`,
    });
    writeFileSync(path.join(appDir, APP_CONFIG_BESTAND), `${JSON.stringify({
        naam,
        poorten: { dev: poorten.dev, acc: poorten.acc, prod: poorten.prod },
        envRoot: `~/AppEnvs/${naam}`,
    }, null, 2)}\n`);
    kop('Repository initialiseren');
    run('git', ['init', '-q', appDir]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], appDir);
    syncNaarApp(appDir);
    ok(`'${naam}' staat klaar op poorten ${String(poorten.dev)} (dev), ${String(poorten.acc)} (acc), ${String(poorten.prod)} (prod)`);
    process.stdout.write(['', 'Volgende stappen:', `  cd ../${naam}`, '  pnpm install', '  pnpm verify', ''].join('\n'));
}
//# sourceMappingURL=nieuw.js.map