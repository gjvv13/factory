import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  buitenDocumenten,
  versWerkplaats,
  werkplaatsVan,
  werkplaatsWortel,
} from '../src/werkplaats.js';
import { maakUitvoerderOpnemer, type ProcesAanroep } from './helpers.js';

function argsVan(aanroepen: ProcesAanroep[], commando: string): string[][] {
  return aanroepen.filter((a) => a.commando === commando).map((a) => a.argumenten);
}

describe('werkplaatsVan', () => {
  it('legt elke spiegel onder één wortel in de home-map', () => {
    expect(werkplaatsVan('beheer')).toBe(path.join(os.homedir(), 'OrkestratorWerk', 'beheer'));
    expect(werkplaatsWortel).toBe(path.join(os.homedir(), 'OrkestratorWerk'));
  });
});

describe('buitenDocumenten', () => {
  it('herkent de werkplaats als buiten ~/Documents', () => {
    // De hele opzet leunt hierop: macOS schermt ~/Documents af voor
    // achtergrondprocessen, en er lopen parallelle sessies in mijn werkkopieën.
    expect(buitenDocumenten(werkplaatsVan('assistant'))).toBe(true);
  });

  it('herkent een pad in ~/Documents, ook een diep genest pad', () => {
    const documenten = path.join(os.homedir(), 'Documents');
    expect(buitenDocumenten(documenten)).toBe(false);
    expect(buitenDocumenten(path.join(documenten, 'Software', 'beheer'))).toBe(false);
  });

  it('trapt niet in een pad dat er alleen op lijkt', () => {
    // `~/DocumentenArchief` begint met dezelfde letters maar ligt er niet in.
    expect(buitenDocumenten(path.join(os.homedir(), 'DocumentsArchief'))).toBe(true);
  });
});

describe('versWerkplaats', () => {
  let wortel: string;

  beforeEach(() => {
    // Een eigen wortel per test: de echte ligt in $HOME en die raken we niet aan.
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-werkplaats-'));
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('kloont de spiegel als hij er nog niet is', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    const pad = versWerkplaats('beheer', 'gjvv13', wortel);

    expect(pad).toBe(path.join(wortel, 'beheer'));
    expect(argsVan(aanroepen, 'gh')[0]?.slice(0, 4)).toEqual([
      'repo',
      'clone',
      'gjvv13/beheer',
      pad,
    ]);
    // Nog niets om te verversen: klonen en verversen sluiten elkaar uit.
    expect(argsVan(aanroepen, 'git')).toEqual([]);
  });

  it('zet een bestaande spiegel hard terug op origin/main', () => {
    mkdirSync(path.join(wortel, 'beheer', '.git'), { recursive: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    versWerkplaats('beheer', 'gjvv13', wortel);

    // Hard terugzetten, geen merge of rebase: er valt niets te bewaren, en een
    // conflict zou de run blokkeren op iets wat niemand ooit gaat oplossen.
    expect(argsVan(aanroepen, 'git')).toEqual([
      ['fetch', '-q', 'origin'],
      ['reset', '--hard', '-q', 'origin/main'],
    ]);
    expect(argsVan(aanroepen, 'gh')).toEqual([]);
  });

  it('draait de git-stappen in de spiegel, niet in de map van de aanroeper', () => {
    mkdirSync(path.join(wortel, 'beheer', '.git'), { recursive: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    versWerkplaats('beheer', 'gjvv13', wortel);

    // Zonder deze cwd zou een `reset --hard` de wérkkopie van de gebruiker treffen.
    for (const aanroep of aanroepen) {
      expect(aanroep.cwd).toBe(path.join(wortel, 'beheer'));
    }
  });

  it('weigert een werkplaats binnen ~/Documents', () => {
    // De hele opzet rust hierop; als iemand het pad ooit verlegt moet dat luid falen.
    expect(() => versWerkplaats('beheer', 'gjvv13', path.join(os.homedir(), 'Documents'))).toThrow(
      /binnen ~\/Documents/,
    );
  });
});
