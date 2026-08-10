import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { leesOmgevingsWaarden, vereisAppConfig, vereisOmgeving, werkmapVan, } from '../app-config.js';
import { GebruikersFout, kop, ok, run, uitvoerVan } from '../shell.js';
/** Hoeveel generaties standaard bewaard blijven als er geen aantal wordt opgegeven. */
const STANDAARD_BEWAAR = 7;
/**
 * Tijdstempel `YYYYMMDD-HHMMSS` in lokale tijd. Bewust nul-gevuld en zonder
 * scheidingstekens binnen datum/tijd, zodat de bestandsnamen lexicaal in
 * chronologische volgorde sorteren — dat maakt het roteren een simpele sortering.
 */
function tijdstempel(nu) {
    const vul = (waarde, lengte = 2) => String(waarde).padStart(lengte, '0');
    const datum = `${vul(nu.getFullYear(), 4)}${vul(nu.getMonth() + 1)}${vul(nu.getDate())}`;
    const tijd = `${vul(nu.getHours())}${vul(nu.getMinutes())}${vul(nu.getSeconds())}`;
    return `${datum}-${tijd}`;
}
/**
 * Maakt een consistente, terughaalbare kopie van de SQLite-database van een
 * omgeving en houdt een paar generaties historie. Consistent via `sqlite3 .backup`
 * (veilig ook met een levend WAL-bestand), niet een kale `cp`. De backups belanden
 * in `<werkmap>/backups/`; off-site kopiëren is een losse stap (slice 3).
 */
export function backup(omgevingArgument, opties = {}) {
    const omgeving = vereisOmgeving(omgevingArgument);
    const bewaar = opties.bewaar ?? STANDAARD_BEWAAR;
    if (!Number.isInteger(bewaar) || bewaar < 1) {
        throw new GebruikersFout('Aantal te bewaren backups moet een geheel getal van 1 of hoger zijn.');
    }
    const config = vereisAppConfig();
    const werkmap = werkmapVan(config, omgeving);
    // Hetzelfde db-pad als de draaiende omgeving: DATABASE_FILE uit de env-bestanden,
    // relatief aan de werkmap (net als de app dat met ROOT_DIR doet).
    const dbBestand = leesOmgevingsWaarden(config.appDir, omgeving).DATABASE_FILE ?? `data/${omgeving}.sqlite`;
    if (dbBestand === ':memory:') {
        throw new GebruikersFout(`${omgeving} draait op een in-memory database; er valt niets te backuppen.`);
    }
    const dbPad = path.resolve(werkmap, dbBestand);
    if (!existsSync(dbPad)) {
        throw new GebruikersFout(`Databasebestand niet gevonden: ${dbPad}`);
    }
    const backupsDir = path.join(werkmap, 'backups');
    mkdirSync(backupsDir, { recursive: true });
    const naam = `${config.naam}-${omgeving}`;
    // De CLI kent geen Clock-abstractie; Date.now() is hier de tijdsbron (net als in
    // verify.ts). Injecteerbaar via `nu` zodat de bestandsnaam in tests vastligt.
    const doel = path.join(backupsDir, `${naam}-${tijdstempel(opties.nu ?? new Date(Date.now()))}.sqlite`);
    kop(`Backup van ${omgeving} (${config.naam})`);
    // `.backup` als één dot-command-argument: sqlite3 strip de quotes zelf, zodat een
    // spatie in het pad geen probleem is (we draaien zonder shell).
    run('sqlite3', [dbPad, `.backup '${doel}'`]);
    // De kopie erft de WAL-modus van een levende prod-db. Terugzetten naar DELETE maakt
    // er één zelfstandig bestand van (checkpoint + geen -wal/-shm-zijbestanden ernaast),
    // wat kopiëren, off-site zetten en terugzetten eenvoudig houdt.
    run('sqlite3', [doel, 'PRAGMA journal_mode=DELETE'], { capture: true });
    // Bewijs meteen dat de kopie te openen is; een onleesbare backup is geen backup.
    const integriteit = uitvoerVan('sqlite3', [doel, 'PRAGMA integrity_check']);
    if (integriteit !== 'ok') {
        throw new GebruikersFout(`Backup gemaakt maar de integriteitscheck faalde: ${integriteit ?? 'geen antwoord'}`);
    }
    // De DELETE-omzetting heeft de data al in het hoofdbestand samengevoegd; een los
    // sqlite3-proces kan nog een lege -wal/-shm hebben laten liggen. Weg ermee, zodat de
    // backup echt één bestand is.
    for (const zijbestand of [`${doel}-wal`, `${doel}-shm`]) {
        if (existsSync(zijbestand)) {
            rmSync(zijbestand);
        }
    }
    ok(`${doel} (integer)`);
    // Roteren: de nieuwste `bewaar` houden, de rest weg. De tijdstempel-namen sorteren
    // lexicaal chronologisch, dus omgekeerd gesorteerd staat de nieuwste vooraan.
    const generaties = readdirSync(backupsDir)
        .filter((bestand) => bestand.startsWith(`${naam}-`) && bestand.endsWith('.sqlite'))
        .sort()
        .reverse();
    const teVerwijderen = generaties.slice(bewaar);
    for (const oud of teVerwijderen) {
        rmSync(path.join(backupsDir, oud));
    }
    if (teVerwijderen.length > 0) {
        ok(`${String(teVerwijderen.length)} oude backup(s) opgeruimd; ${String(bewaar)} bewaard`);
    }
}
//# sourceMappingURL=backup.js.map