import { readFileSync } from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import { schrijfGecombineerdeDekking } from '../coverage-merge.js';
import { beoordeelRatchet, leesBasislijn, schrijfBasislijn, BASISLIJN_BESTAND, } from '../dekking-basislijn.js';
import { leesDekkingsConfig } from '../dekking-config.js';
import { toetsConfigSleutels } from '../config-sleutels.js';
import { toetsFlagVerloop } from '../flag-verloop.js';
import { draaiScript, kop, ok, run, waarschuwing, GebruikersFout, OmgevingsFout, } from '../shell.js';
/**
 * De vaste volgorde van de kwaliteitspoort. Een stap die de repo niet heeft
 * wordt overgeslagen, zodat dezelfde poort werkt in de factory (die geen
 * e2e-tests heeft) en in een applicatie (die ze wel heeft).
 */
export const STAPPEN = [
    { script: 'format:check', titel: 'Opmaak (prettier)', snel: true, preCommit: true },
    { script: 'lint', titel: 'Statische analyse (eslint)', snel: true, preCommit: true },
    { script: 'typecheck', titel: 'Types (tsc)', snel: true, preCommit: true },
    { script: 'test:unit', titel: 'Unit tests', snel: true, preCommit: true, coverageNaam: 'unit' },
    {
        script: 'test:contract',
        titel: 'Contract tests',
        snel: true,
        preCommit: false,
        coverageNaam: 'contract',
    },
    {
        script: 'test:pact-verify',
        titel: 'Pact provider-verificatie',
        snel: false,
        preCommit: false,
    },
    {
        script: 'test:integration',
        titel: 'Integration tests',
        snel: false,
        preCommit: false,
    },
    {
        script: 'test:e2e',
        titel: 'End-to-end tests',
        snel: false,
        preCommit: false,
        coverageNaam: 'e2e',
    },
    { script: 'build', titel: 'Build', snel: true, preCommit: false },
];
export function beschikbareScripts(repoDir) {
    const bestand = path.join(repoDir, 'package.json');
    let inhoud;
    try {
        inhoud = JSON.parse(readFileSync(bestand, 'utf8'));
    }
    catch {
        throw new OmgevingsFout(`Kon ${bestand} niet lezen. Draait dit in een repo?`);
    }
    const scripts = typeof inhoud === 'object' && inhoud !== null && 'scripts' in inhoud
        ? inhoud.scripts
        : undefined;
    return new Set(Object.keys(scripts ?? {}));
}
/**
 * Leest het dekkingspercentage (regels) uit het json-summary-rapport van een
 * testsoort. Geen rapport of een onverwacht formaat levert `undefined` op — de
 * poort mag daar niet op omvallen (in slice 1 tonen we alleen, we oordelen niet).
 */
function leesDekking(repoDir, naam) {
    const bestand = path.join(repoDir, 'coverage', naam, 'coverage-summary.json');
    let data;
    try {
        data = JSON.parse(readFileSync(bestand, 'utf8'));
    }
    catch {
        return undefined;
    }
    if (typeof data !== 'object' || data === null || !('total' in data))
        return undefined;
    const total = data.total;
    if (typeof total !== 'object' || total === null || !('lines' in total))
        return undefined;
    const lines = total.lines;
    if (typeof lines !== 'object' || lines === null || !('pct' in lines))
        return undefined;
    const pct = lines.pct;
    return typeof pct === 'number' ? pct : undefined;
}
/** De app-config van de repo waarin verify draait, of undefined buiten een applicatie. */
function appConfigVanRepo(repoDir) {
    const appDir = zoekAppDir(repoDir);
    return appDir === undefined ? undefined : leesAppConfig(appDir);
}
/** `lines 91.2%→85.4%` — één metric in de terminaluitvoer van de ratchet. */
function beschrijfVerschil(verschil) {
    return `${verschil.naam} ${String(verschil.was)}%→${String(verschil.nu)}%`;
}
/**
 * De dekkings-ratchet: vergelijkt de gemeten dekking met de vastgelegde basislijn (het hoogste
 * niveau dat de app ooit haalde) en houdt die bij. Zo kan de dekking niet stil wegzakken tot de
 * vaste `dekkingsMinimum`-bodem. Zonder eerdere basislijn is dit een bootstrap: vastleggen zonder
 * oordeel. Een regressie waarschuwt (`waarschuw`) of laat verify falen (`blokkeer`); winst schuift
 * de basislijn omhoog. De aanroeper heeft `dekkingsRatchet === 'uit'` al uitgesloten.
 */
function pasRatchetToe(config, nu) {
    const oordeel = beoordeelRatchet(nu, leesBasislijn(config.dir), config.dekkingsTolerantie);
    kop('Dekkings-ratchet');
    if (oordeel.bootstrap) {
        if (oordeel.nieuweBasislijn !== undefined) {
            schrijfBasislijn(config.dir, oordeel.nieuweBasislijn);
        }
        process.stdout.write(`  basislijn aangemaakt — commit ${BASISLIJN_BESTAND} (lines ${String(nu.lines)}%)\n`);
        return;
    }
    if (oordeel.regressies.length > 0) {
        const melding = `Dekking zakt onder de basislijn: ${oordeel.regressies
            .map(beschrijfVerschil)
            .join(', ')} (${BASISLIJN_BESTAND}).`;
        // Bij een regressie leggen we geen winst vast: een run die óók zakt mag de lat niet verzetten.
        if (config.dekkingsRatchet === 'blokkeer') {
            throw new GebruikersFout(melding);
        }
        waarschuwing(melding);
        return;
    }
    if (oordeel.nieuweBasislijn !== undefined) {
        schrijfBasislijn(config.dir, oordeel.nieuweBasislijn);
        process.stdout.write(`  basislijn verhoogd: ${oordeel.verhogingen.map(beschrijfVerschil).join(', ')} — commit ${BASISLIJN_BESTAND}\n`);
        return;
    }
    process.stdout.write(`  op niveau (lines ${String(nu.lines)}%)\n`);
}
/**
 * Bepaalt of de gemeten dekking onder de drempel zakt. De "totaal" is bij voorkeur het
 * gemergede cijfer (de echte gecombineerde dekking); ontbreekt dat, dan valt hij terug op
 * de hoogste losse soort — een veilige ondergrens. Zonder drempel, of zonder enige meting,
 * geven we geen oordeel.
 */
export function beoordeelDekking(dekkingen, minimum, gecombineerd) {
    if (minimum === undefined) {
        return undefined;
    }
    const totaal = gecombineerd ?? (dekkingen.length > 0 ? Math.max(...dekkingen) : undefined);
    if (totaal === undefined) {
        return undefined;
    }
    return { totaal, faalt: totaal < minimum };
}
/** De ernstniveaus van een advisory, oplopend. */
const AUDIT_NIVEAUS = ['info', 'low', 'moderate', 'high', 'critical'];
/**
 * Telt de kwetsbaarheden vanaf een drempelniveau uit de json-uitvoer van
 * `pnpm audit`.
 *
 * Geeft `undefined` als de uitvoer niet te lezen is. Dat betekent "de audit kon
 * niet draaien" — meestal geen netwerk (zie #99) — en dat is iets anders dan
 * "niets gevonden". De poort mag niet groen kleuren op een controle die niet
 * heeft plaatsgevonden, en ook niet omvallen op een netwerkhapering die los
 * staat van de wijziging.
 */
export function telKwetsbaarheden(uitvoer, vanaf) {
    let data;
    try {
        data = JSON.parse(uitvoer);
    }
    catch {
        return undefined;
    }
    const tellingen = typeof data === 'object' && data !== null && 'metadata' in data
        ? data.metadata
            ?.vulnerabilities
        : undefined;
    if (tellingen === undefined) {
        return undefined;
    }
    const drempel = AUDIT_NIVEAUS.indexOf(vanaf);
    const perNiveau = {};
    let aantal = 0;
    for (const [niveau, waarde] of Object.entries(tellingen)) {
        const positie = AUDIT_NIVEAUS.indexOf(niveau);
        if (positie < drempel || typeof waarde !== 'number' || waarde === 0) {
            continue;
        }
        perNiveau[niveau] = waarde;
        aantal += waarde;
    }
    return { aantal, perNiveau };
}
/**
 * Toetst de afhankelijkheden op bekende kwetsbaarheden. Draait alleen bij de
 * volledige poort: de stap kost netwerk en zegt niets over de wijziging zelf.
 */
function toetsAfhankelijkheden(repoDir, config) {
    const stand = config?.audit ?? 'waarschuw';
    if (stand === 'uit') {
        return;
    }
    const vanaf = config?.auditNiveau ?? 'high';
    kop('Afhankelijkheden (pnpm audit)');
    // `pnpm audit` sluit af met een niet-nul code zodra het iets vindt, dus we
    // beoordelen de uitvoer en niet de exitcode.
    const uitkomst = run('pnpm', ['audit', '--json'], {
        cwd: repoDir,
        capture: true,
        toleranter: true,
    });
    const telling = telKwetsbaarheden(uitkomst.stdout, vanaf);
    if (telling === undefined) {
        waarschuwing('audit kon niet draaien (geen netwerk?) — overgeslagen, niets getoetst.');
        return;
    }
    if (telling.aantal === 0) {
        ok(`geen kwetsbaarheden vanaf ${vanaf}`);
        return;
    }
    const uitsplitsing = Object.entries(telling.perNiveau)
        .map(([niveau, n]) => `${String(n)}× ${niveau}`)
        .join(', ');
    const melding = telling.aantal === 1
        ? `1 kwetsbaarheid vanaf ${vanaf} (${uitsplitsing})`
        : `${String(telling.aantal)} kwetsbaarheden vanaf ${vanaf} (${uitsplitsing})`;
    if (stand === 'blokkeer') {
        throw new GebruikersFout(`${melding}. Draai \`pnpm audit\` voor de details.`);
    }
    waarschuwing(`${melding} — draai \`pnpm audit\` voor de details.`);
}
export function verify(opties = {}) {
    const repoDir = opties.cwd ?? process.cwd();
    const aanwezig = beschikbareScripts(repoDir);
    const start = Date.now();
    // Coverage draait alleen bij een volledige poort; --snel en --pre-commit slaan
    // het over zodat lokaal en de pre-commit hook snel blijven.
    const metCoverage = opties.snel !== true && opties.preCommit !== true;
    if (opties.preCommit === true) {
        kop('pre-commit: opmaak, lint, types, unit tests');
    }
    let gedraaid = 0;
    const overgeslagen = [];
    const dekkingen = [];
    for (const stap of STAPPEN) {
        if (!aanwezig.has(stap.script)) {
            continue;
        }
        if (opties.preCommit === true && !stap.preCommit) {
            continue;
        }
        if (opties.snel === true && !stap.snel) {
            overgeslagen.push(stap.titel);
            continue;
        }
        if (opties.preCommit !== true) {
            kop(stap.titel);
        }
        const dekkingNaam = metCoverage ? stap.coverageNaam : undefined;
        draaiScript(stap.script, repoDir, dekkingNaam === undefined ? undefined : { ...process.env, FACTORY_COVERAGE: '1' });
        if (dekkingNaam !== undefined) {
            const pct = leesDekking(repoDir, dekkingNaam);
            if (pct !== undefined) {
                dekkingen.push(pct);
                process.stdout.write(`  dekking: ${String(pct)}%\n`);
            }
        }
        gedraaid += 1;
    }
    if (gedraaid === 0) {
        throw new GebruikersFout('Geen enkele poortstap gevonden in package.json (verwacht bijvoorbeeld lint of test:unit).');
    }
    if (metCoverage) {
        // Voeg de per-soort istanbul-maps samen tot één gecombineerd cijfer; dat is de
        // eerlijke basis voor de drempel (i.p.v. de hoogste losse soort).
        const gecombineerd = schrijfGecombineerdeDekking(repoDir);
        const dekkingsConfig = leesDekkingsConfig(repoDir);
        const minimum = dekkingsConfig?.dekkingsMinimum;
        // De vaste bodem toetst tegen de regeldekking; de ratchet (hieronder) bewaakt alle vier.
        const oordeel = beoordeelDekking(dekkingen, minimum, gecombineerd?.lines);
        if (oordeel !== undefined && minimum !== undefined) {
            kop('Dekkingsdrempel');
            if (oordeel.faalt) {
                throw new GebruikersFout(`Te weinig dekking: totaal ${String(oordeel.totaal)}% < drempel ${String(minimum)}% (dekkingsMinimum).`);
            }
            process.stdout.write(`  totaal ${String(oordeel.totaal)}% ≥ ${String(minimum)}%\n`);
        }
        else if (gecombineerd !== undefined) {
            kop('Gecombineerde dekking');
            process.stdout.write(`  totaal ${String(gecombineerd.lines)}%\n`);
        }
        if (gecombineerd !== undefined &&
            dekkingsConfig !== undefined &&
            dekkingsConfig.dekkingsRatchet !== 'uit') {
            pasRatchetToe(dekkingsConfig, gecombineerd);
        }
        const appConfig = appConfigVanRepo(repoDir);
        const flagStand = appConfig?.flagVerloop ?? 'waarschuw';
        if (flagStand !== 'uit') {
            toetsFlagVerloop(appConfig?.appDir ?? repoDir, flagStand, new Date(Date.now()));
        }
        toetsAfhankelijkheden(repoDir, appConfig);
        toetsConfigSleutels(repoDir, appConfig, aanwezig);
    }
    for (const titel of overgeslagen) {
        waarschuwing(`${titel} overgeslagen (--snel)`);
    }
    const seconden = Math.round((Date.now() - start) / 1000);
    process.stdout.write('\n');
    ok(`Alles groen in ${String(seconden)}s`);
}
//# sourceMappingURL=verify.js.map