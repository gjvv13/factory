import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nieuw } from '../src/commands/nieuw.js';
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
    });

    // De tokens in het echte skeleton zijn ingevuld, niets blijft staan.
    const pakket = readFileSync(path.join(appDir, 'package.json'), 'utf8');
    expect(pakket).toContain('"name": "proefapp"');
    expect(pakket).not.toContain('{{APP_NAAM}}');
    expect(pakket).not.toContain('{{FACTORY_DEP}}');

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
});
