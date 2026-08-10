import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  leesOmgevingsWaarden,
  vereisAppConfig,
  vereisOmgeving,
  werkmapVan,
} from '../app-config.js';
import { GebruikersFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';

/** Hoeveel generaties standaard bewaard blijven als er geen aantal wordt opgegeven. */
const STANDAARD_BEWAAR = 7;

/**
 * Tijdstempel `YYYYMMDD-HHMMSS` in lokale tijd. Bewust nul-gevuld en zonder
 * scheidingstekens binnen datum/tijd, zodat de bestandsnamen lexicaal in
 * chronologische volgorde sorteren — dat maakt het roteren een simpele sortering.
 */
function tijdstempel(nu: Date): string {
  const vul = (waarde: number, lengte = 2): string => String(waarde).padStart(lengte, '0');
  const datum = `${vul(nu.getFullYear(), 4)}${vul(nu.getMonth() + 1)}${vul(nu.getDate())}`;
  const tijd = `${vul(nu.getHours())}${vul(nu.getMinutes())}${vul(nu.getSeconds())}`;
  return `${datum}-${tijd}`;
}

/**
 * Bewijst dat een backupbestand te openen is; een onleesbare backup is geen backup.
 * Gooit met de context van waar de check faalde.
 */
function controleerIntegriteit(bestand: string, waar: string): void {
  const integriteit = uitvoerVan('sqlite3', [bestand, 'PRAGMA integrity_check']);
  if (integriteit !== 'ok') {
    throw new GebruikersFout(
      `Backup ${waar} maar de integriteitscheck faalde: ${integriteit ?? 'geen antwoord'}`,
    );
  }
}

/**
 * Houdt in `dir` de nieuwste `bewaar` generaties met het gegeven voorvoegsel en
 * verwijdert de rest. De tijdstempel-namen sorteren lexicaal chronologisch, dus
 * omgekeerd gesorteerd staat de nieuwste vooraan. Geeft het aantal opgeruimde terug.
 */
function roteer(dir: string, voorvoegsel: string, bewaar: number): number {
  const generaties = readdirSync(dir)
    .filter((bestand) => bestand.startsWith(`${voorvoegsel}-`) && bestand.endsWith('.sqlite'))
    .sort()
    .reverse();
  const teVerwijderen = generaties.slice(bewaar);
  for (const oud of teVerwijderen) {
    rmSync(path.join(dir, oud));
  }
  return teVerwijderen.length;
}

export interface BackupOpties {
  /** Hoeveel generaties bewaard blijven (nieuwste eerst). Standaard 7. */
  readonly bewaar?: number;
  /**
   * Map buiten de Mac (bijv. een externe schijf) waar de verse backup óók heen gaat,
   * mét eigen rotatie. Is de schijf niet aangesloten, dan slaan we deze stap over met
   * een waarschuwing in plaats van de hele backup te laten falen.
   */
  readonly offsiteDir?: string;
  /** Injecteerbaar zodat de bestandsnaam in tests deterministisch is. */
  readonly nu?: Date;
}

/**
 * Maakt een consistente, terughaalbare kopie van de SQLite-database van een
 * omgeving en houdt een paar generaties historie. Consistent via `sqlite3 .backup`
 * (veilig ook met een levend WAL-bestand), niet een kale `cp`. De backups belanden
 * in `<werkmap>/backups/`; met `offsiteDir` gaat de verse kopie er óók buiten de Mac
 * heen.
 */
export function backup(omgevingArgument: string | undefined, opties: BackupOpties = {}): void {
  const omgeving = vereisOmgeving(omgevingArgument);
  const bewaar = opties.bewaar ?? STANDAARD_BEWAAR;
  if (!Number.isInteger(bewaar) || bewaar < 1) {
    throw new GebruikersFout(
      'Aantal te bewaren backups moet een geheel getal van 1 of hoger zijn.',
    );
  }

  const config = vereisAppConfig();
  const werkmap = werkmapVan(config, omgeving);
  // Hetzelfde db-pad als de draaiende omgeving: DATABASE_FILE uit de env-bestanden,
  // relatief aan de werkmap (net als de app dat met ROOT_DIR doet).
  const dbBestand =
    leesOmgevingsWaarden(config.appDir, omgeving).DATABASE_FILE ?? `data/${omgeving}.sqlite`;
  if (dbBestand === ':memory:') {
    throw new GebruikersFout(
      `${omgeving} draait op een in-memory database; er valt niets te backuppen.`,
    );
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
  const bestandsnaam = `${naam}-${tijdstempel(opties.nu ?? new Date(Date.now()))}.sqlite`;
  const doel = path.join(backupsDir, bestandsnaam);

  kop(`Backup van ${omgeving} (${config.naam})`);
  // `.backup` als één dot-command-argument: sqlite3 strip de quotes zelf, zodat een
  // spatie in het pad geen probleem is (we draaien zonder shell).
  run('sqlite3', [dbPad, `.backup '${doel}'`]);

  // De kopie erft de WAL-modus van een levende prod-db. Terugzetten naar DELETE maakt
  // er één zelfstandig bestand van (checkpoint + geen -wal/-shm-zijbestanden ernaast),
  // wat kopiëren, off-site zetten en terugzetten eenvoudig houdt.
  run('sqlite3', [doel, 'PRAGMA journal_mode=DELETE'], { capture: true });
  controleerIntegriteit(doel, 'gemaakt');

  // De DELETE-omzetting heeft de data al in het hoofdbestand samengevoegd; een los
  // sqlite3-proces kan nog een lege -wal/-shm hebben laten liggen. Weg ermee, zodat de
  // backup echt één bestand is.
  for (const zijbestand of [`${doel}-wal`, `${doel}-shm`]) {
    if (existsSync(zijbestand)) {
      rmSync(zijbestand);
    }
  }
  ok(`${doel} (integer)`);

  const opgeruimd = roteer(backupsDir, naam, bewaar);
  if (opgeruimd > 0) {
    ok(`${String(opgeruimd)} oude backup(s) opgeruimd; ${String(bewaar)} bewaard`);
  }

  if (opties.offsiteDir !== undefined) {
    kopieerOffsite(opties.offsiteDir, doel, bestandsnaam, naam, bewaar);
  }
}

/**
 * Kopieert de verse backup naar een map buiten de Mac en roteert daar ook. Is de
 * schijf niet aangesloten (de bovenliggende map bestaat niet), dan slaan we het over
 * met een waarschuwing: de lokale backup is dan al gemaakt en het proces mag niet
 * falen op een losgekoppelde schijf. We maken bewust alleen de doelmap zelf aan en
 * nooit het mount-pad erboven — anders zou een schaduwmap de schijf verbergen.
 */
function kopieerOffsite(
  offsiteDir: string,
  bron: string,
  bestandsnaam: string,
  voorvoegsel: string,
  bewaar: number,
): void {
  kop('Off-site kopie');
  if (!existsSync(offsiteDir) && !existsSync(path.dirname(offsiteDir))) {
    waarschuwing(`off-site schijf niet gevonden (${offsiteDir}); overgeslagen`);
    return;
  }
  mkdirSync(offsiteDir, { recursive: true });
  const offsiteDoel = path.join(offsiteDir, bestandsnaam);
  // Een platte kopie volstaat: de backup is één zelfstandig DELETE-bestand.
  copyFileSync(bron, offsiteDoel);
  controleerIntegriteit(offsiteDoel, 'off-site gezet');
  ok(`${offsiteDoel} (integer)`);

  const opgeruimd = roteer(offsiteDir, voorvoegsel, bewaar);
  if (opgeruimd > 0) {
    ok(`off-site: ${String(opgeruimd)} oude backup(s) opgeruimd; ${String(bewaar)} bewaard`);
  }
}
