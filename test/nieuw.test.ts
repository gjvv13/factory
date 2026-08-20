import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nieuw } from '../src/commands/nieuw.js';
import { skeletonDir } from '../src/paths.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type Opnemer } from './helpers.js';

/**
 * Bouwt een tijdelijke werkruimte met een nep-factory-repo: een lege
 * skeleton-map, genoeg om vereisFactoryRepo tevreden te stellen. De echte
 * token-vervanging draait daarna tegen het echte skeleton uit het pakket.
 */
function maakWerkruimte(): { factoryRepo: string; werkruimte: string } {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-nieuw-'));
  const factoryRepo = path.join(werkruimte, 'factory');
  mkdirSync(path.join(factoryRepo, 'skeleton'), { recursive: true });
  return { factoryRepo, werkruimte };
}

function schrijfZusterApp(werkruimte: string, naam: string, prodPoort: number): void {
  const dir = path.join(werkruimte, naam);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'factory.json'),
    JSON.stringify({
      naam,
      poorten: { dev: prodPoort + 1, acc: prodPoort + 2, prod: prodPoort },
      envRoot: `~/AppEnvs/${naam}`,
    }),
  );
}

describe('nieuw', () => {
  let oorspronkelijkeCwd: string;
  let opnemer: Opnemer;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    // De voortgangsmeldingen van nieuw() horen niet in de testuitvoer thuis.
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    opnemer = maakUitvoerderOpnemer();
    stelUitvoerderIn(opnemer.uitvoerder);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('maakt een applicatie uit het skeleton op het eerste vrije poortblok en vult de tokens in', () => {
    const { factoryRepo, werkruimte } = maakWerkruimte();
    process.chdir(factoryRepo);

    nieuw('proefapp');

    const appDir = path.join(werkruimte, 'proefapp');
    const config: unknown = JSON.parse(readFileSync(path.join(appDir, 'factory.json'), 'utf8'));
    expect(config).toMatchObject({
      naam: 'proefapp',
      poorten: { prod: 3000, dev: 3001, acc: 3002 },
      // Private repo → lokale wachtrij, niet de merge-queue-default (#108).
      integratie: 'lokaal',
    });

    // De tokens in het echte skeleton zijn ingevuld, niets blijft staan.
    const pakket = readFileSync(path.join(appDir, 'package.json'), 'utf8');
    expect(pakket).toContain('"name": "proefapp"');
    expect(pakket).not.toContain('{{APP_NAAM}}');
    expect(pakket).not.toContain('{{FACTORY_DEP}}');

    // De README uit het skeleton wordt meegekopieerd en zijn placeholders ingevuld.
    const readme = readFileSync(path.join(appDir, 'README.md'), 'utf8');
    expect(readme).toContain('# proefapp');
    expect(readme).not.toContain('{{APP_NAAM}}');
    expect(readme).not.toContain('{{PORT_DEV}}');

    // De repo wordt geïnitialiseerd via de nep-uitvoerder; er is geen echte git nodig.
    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({ commando: 'git', argumenten: expect.arrayContaining(['init']) }),
    );

    // De applicatie wordt als optie op het App-veld van het board gezet (via de
    // GraphQL-API), zodat een nieuw issue meteen in de juiste kolom valt.
    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'gh',
        argumenten: expect.arrayContaining(['api', 'graphql']),
      }),
    );
  });

  it('geeft de nieuwe app een .gitignore en laat geen gitignore of .npmignore achter', () => {
    // #91: het skeleton draagt het bestand als `gitignore` (zonder punt), omdat npm's
    // pack-laag een `.gitignore` niet in het pakket laat overleven. `nieuw` zet de punt
    // terug; zonder die stap kreeg elke app die uit een geïnstalleerde factory kwam er
    // geen.
    const { factoryRepo, werkruimte } = maakWerkruimte();
    process.chdir(factoryRepo);

    nieuw('proefapp');

    const appDir = path.join(werkruimte, 'proefapp');
    const gitignore = readFileSync(path.join(appDir, '.gitignore'), 'utf8');
    // Inhoud gelijk aan het skeleton, niet een eigen lijstje dat kan afdrijven.
    expect(gitignore).toBe(readFileSync(path.join(skeletonDir, 'gitignore'), 'utf8'));
    expect(existsSync(path.join(appDir, 'gitignore'))).toBe(false);
    expect(existsSync(path.join(appDir, '.npmignore'))).toBe(false);
  });

  it('waarschuwt en gaat door als het skeleton geen gitignore heeft', () => {
    // Een app zonder .gitignore is hinderlijk; halverwege afbreken is erger.
    const { factoryRepo, werkruimte } = maakWerkruimte();
    process.chdir(factoryRepo);
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const echteBron = path.join(skeletonDir, 'gitignore');
    const geparkeerd = `${echteBron}.geparkeerd`;
    renameSync(echteBron, geparkeerd);
    try {
      nieuw('proefapp');
    } finally {
      renameSync(geparkeerd, echteBron);
    }

    const appDir = path.join(werkruimte, 'proefapp');
    expect(existsSync(path.join(appDir, 'factory.json'))).toBe(true);
    expect(existsSync(path.join(appDir, '.gitignore'))).toBe(false);
    expect(schrijf.mock.calls.map(String).join('')).toMatch(/geen 'gitignore'/);
  });

  it('kiest het volgende poortblok als het eerste al bezet is', () => {
    const { factoryRepo, werkruimte } = maakWerkruimte();
    schrijfZusterApp(werkruimte, 'bezet', 3000);
    process.chdir(factoryRepo);

    nieuw('tweede');

    const config: unknown = JSON.parse(
      readFileSync(path.join(werkruimte, 'tweede', 'factory.json'), 'utf8'),
    );
    expect(config).toMatchObject({ poorten: { prod: 3010, dev: 3011, acc: 3012 } });
  });

  it('weigert een naam die al als map bestaat', () => {
    const { factoryRepo, werkruimte } = maakWerkruimte();
    mkdirSync(path.join(werkruimte, 'bestaat'));
    process.chdir(factoryRepo);

    expect(() => {
      nieuw('bestaat');
    }).toThrow(/bestaat al/);
  });

  it('weigert een ongeldige naam', () => {
    const { factoryRepo } = maakWerkruimte();
    process.chdir(factoryRepo);

    expect(() => {
      nieuw('Ongeldige Naam');
    }).toThrow(/kleine letters/);
  });

  it('commit het skeleton en maakt een private GitHub-repo met een gepushte main', () => {
    const { factoryRepo } = maakWerkruimte();
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    process.chdir(factoryRepo);

    nieuw('proefapp');

    // Er komt een init-commit vóór de push; zonder node_modules kan de pre-commit-poort
    // niet draaien, dus expliciet --no-verify.
    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'git',
        argumenten: expect.arrayContaining(['commit', '--no-verify']),
      }),
    );
    // De repo wordt privé aangemaakt, met origin en een gepushte main, in één gh-aanroep.
    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'gh',
        argumenten: expect.arrayContaining([
          'repo',
          'create',
          'gjvv13/proefapp',
          '--private',
          '--push',
        ]),
      }),
    );
    // De deploy-checklist (secret + runner) wordt afgedrukt, maar niets ervan
    // automatisch uitgevoerd.
    const uitvoer = schrijf.mock.calls.map((c) => String(c[0])).join('');
    expect(uitvoer).toContain('PROD_SECRETS_ENV');
    expect(uitvoer).toContain('setup-runner.sh proefapp');
  });

  it('valt netjes terug als gh de repo niet kan aanmaken: geen crash, app blijft, handmatige route', () => {
    const { factoryRepo, werkruimte } = maakWerkruimte();
    // gh repo create faalt (uitgelogd, geen recht, of de repo bestaat al).
    const opnemerMetFout = maakUitvoerderOpnemer((aanroep) =>
      aanroep.commando === 'gh' && aanroep.argumenten[0] === 'repo' ? { code: 1 } : {},
    );
    stelUitvoerderIn(opnemerMetFout.uitvoerder);
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    process.chdir(factoryRepo);

    expect(() => {
      nieuw('proefapp');
    }).not.toThrow();

    // De app is lokaal wél aangemaakt.
    expect(readFileSync(path.join(werkruimte, 'proefapp', 'factory.json'), 'utf8')).toContain(
      '"naam": "proefapp"',
    );
    // En de gebruiker krijgt de handmatige repo-stap plus de checklist te zien.
    const uitvoer = schrijf.mock.calls.map((c) => String(c[0])).join('');
    expect(uitvoer).toContain('gh repo create gjvv13/proefapp');
    expect(uitvoer).toContain('PROD_SECRETS_ENV');
  });
});
