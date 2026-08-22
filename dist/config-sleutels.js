import { z } from 'zod';
import { configSamenvatting } from './env-herstart.js';
import { kop, ok, run, waarschuwing, GebruikersFout } from './shell.js';
/** Het contract dat het `config:sleutels`-script op stdout print. */
const sleutelContractSchema = z.object({
    verwacht: z.array(z.string()),
    geheim: z.array(z.string()).default([]),
});
/**
 * Vergelijkt de verwachte sleutels (uit het `config:sleutels`-script) met de
 * env-bestanden van één omgeving. Hergebruikt `configSamenvatting` uit
 * `env-herstart.ts`, die al per omgeving rapporteert welke bestanden er zijn,
 * welke sleutels erin staan en welke leeg zijn.
 */
export function vergelijkSleutels(appDir, omgeving, contract) {
    const samenvatting = configSamenvatting(appDir, omgeving);
    const aanwezig = new Set(samenvatting.sleutels);
    const ontbrekend = contract.verwacht.filter((s) => !aanwezig.has(s));
    // Geheime sleutels worden alleen gecontroleerd als het secrets-bestand er is.
    const secretsBestand = `${omgeving}.secrets.env`;
    const heeftSecrets = samenvatting.bestanden.includes(secretsBestand);
    const ontbrekendGeheim = heeftSecrets ? contract.geheim.filter((s) => !aanwezig.has(s)) : [];
    const nietControleerbaar = heeftSecrets ? 0 : contract.geheim.length;
    // Lege sleutels: sleutels die in het bestand staan maar geen waarde hebben,
    // beperkt tot sleutels die de code verwacht.
    const verwachtEnGeheim = new Set([...contract.verwacht, ...contract.geheim]);
    const leeg = samenvatting.legeSleutels.filter((s) => verwachtEnGeheim.has(s));
    return { omgeving, ontbrekend, ontbrekendGeheim, nietControleerbaar, leeg };
}
/**
 * Draait het `config:sleutels`-script en parst de uitvoer. Geeft `undefined` als
 * de uitvoer niet geldig is — dan is het script kapot, niet de config.
 */
export function leesSleutelContract(repoDir) {
    const uitkomst = run('pnpm', ['run', 'config:sleutels'], {
        cwd: repoDir,
        capture: true,
        toleranter: true,
    });
    if (uitkomst.code !== 0) {
        return undefined;
    }
    // Het script print één regel JSON op stdout; eventuele andere regels (pnpm-
    // banners, warnings) filteren we eruit door alleen de laatste regel te nemen
    // die met `{` begint.
    const jsonRegel = uitkomst.stdout
        .split('\n')
        .filter((r) => r.trimStart().startsWith('{'))
        .pop();
    if (jsonRegel === undefined) {
        return undefined;
    }
    const parsed = sleutelContractSchema.safeParse(JSON.parse(jsonRegel));
    return parsed.success ? parsed.data : undefined;
}
/**
 * De config-sleuteltoets: controleert per omgeving of de env-bestanden de sleutels
 * bevatten die de code verwacht. Draait alleen bij de volledige poort (niet bij
 * `--snel` of `--pre-commit`), net als audit.
 */
export function toetsConfigSleutels(repoDir, config, scripts) {
    const stand = config?.configSleutels ?? 'waarschuw';
    if (stand === 'uit') {
        return;
    }
    if (!scripts.has('config:sleutels')) {
        return;
    }
    kop('Config-sleutels');
    const contract = leesSleutelContract(repoDir);
    if (contract === undefined) {
        waarschuwing('config:sleutels kon niet draaien of leverde ongeldige uitvoer — overgeslagen.');
        return;
    }
    const omgevingen = ['acc', 'prod'];
    const resultaten = omgevingen.map((omg) => vergelijkSleutels(config?.appDir ?? repoDir, omg, contract));
    const fouten = [];
    for (const r of resultaten) {
        for (const sleutel of r.ontbrekend) {
            fouten.push(`${r.omgeving}: ${sleutel} ontbreekt in ${r.omgeving}.env`);
        }
        for (const sleutel of r.ontbrekendGeheim) {
            fouten.push(`${r.omgeving}: ${sleutel} ontbreekt in ${r.omgeving}.secrets.env`);
        }
        if (r.nietControleerbaar > 0) {
            waarschuwing(`${r.omgeving}: ${String(r.nietControleerbaar)} geheime sleutel${r.nietControleerbaar === 1 ? '' : 's'} niet controleerbaar (${r.omgeving}.secrets.env ontbreekt)`);
        }
        for (const sleutel of r.leeg) {
            waarschuwing(`${r.omgeving}: ${sleutel} is leeg`);
        }
    }
    if (fouten.length === 0) {
        const totaal = contract.verwacht.length + contract.geheim.length;
        ok(`acc en prod bij (${String(totaal)} sleutels)`);
        return;
    }
    for (const fout of fouten) {
        if (stand === 'blokkeer') {
            // Bij blokkeer: alle fouten tonen en daarna falen.
        }
        waarschuwing(fout);
    }
    if (stand === 'blokkeer') {
        throw new GebruikersFout(`${String(fouten.length)} ontbrekende config-sleutel${fouten.length === 1 ? '' : 's'}. Vul de env-bestanden aan.`);
    }
}
//# sourceMappingURL=config-sleutels.js.map