import { afterEach, describe, expect, it } from 'vitest';
import { beoordeelDekking, verify } from '../src/commands/verify.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import type { ProcesUitkomst } from '../src/shell.js';

/**
 * Coverage draait via de omgevingsvariabele `FACTORY_COVERAGE`, die `verify`
 * alleen bij een volledige poort zet. We vangen de uitvoerder af en kijken of die
 * vlag bij de test-stap wél/niet meekomt — zonder echt pnpm of vitest te starten.
 */
interface Aanroep {
  readonly script: string;
  readonly coverage: boolean;
}

function vangAanroepen(): Aanroep[] {
  const aanroepen: Aanroep[] = [];
  stelUitvoerderIn((_commando, argumenten, options): ProcesUitkomst => {
    const script = argumenten[argumenten.indexOf('run') + 1] ?? '';
    aanroepen.push({ script, coverage: options.env?.FACTORY_COVERAGE === '1' });
    return { code: 0, stdout: '' };
  });
  return aanroepen;
}

afterEach(() => {
  herstelUitvoerder();
});

describe('verify — coverage', () => {
  it('meet coverage op de test-stap bij een volledige poort', () => {
    const aanroepen = vangAanroepen();
    verify();
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(true);
  });

  it('slaat coverage over bij --snel', () => {
    const aanroepen = vangAanroepen();
    verify({ snel: true });
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(false);
  });

  it('slaat coverage over bij --pre-commit', () => {
    const aanroepen = vangAanroepen();
    verify({ preCommit: true });
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(false);
  });
});

describe('beoordeelDekking', () => {
  it('geeft geen oordeel zonder ingestelde drempel', () => {
    expect(beoordeelDekking([72], undefined)).toBeUndefined();
  });

  it('geeft geen oordeel zonder metingen', () => {
    expect(beoordeelDekking([], 80)).toBeUndefined();
  });

  it('faalt als het totaal onder de drempel zakt', () => {
    expect(beoordeelDekking([71, 60], 80)).toEqual({ totaal: 71, faalt: true });
  });

  it('slaagt als het totaal de drempel haalt', () => {
    expect(beoordeelDekking([72, 90], 80)).toEqual({ totaal: 90, faalt: false });
  });

  it('gebruikt het gemergede totaal als dat er is, in plaats van de hoogste soort', () => {
    // De losse soorten halen 95%, maar de echte gecombineerde dekking is 60%: die telt.
    expect(beoordeelDekking([95, 40], 80, 60)).toEqual({ totaal: 60, faalt: true });
  });

  it('valt terug op de hoogste soort als er geen merge-cijfer is', () => {
    expect(beoordeelDekking([72, 90], 80, undefined)).toEqual({ totaal: 90, faalt: false });
  });

  it('geeft geen oordeel zonder metingen én zonder merge-cijfer', () => {
    expect(beoordeelDekking([], 80, undefined)).toBeUndefined();
  });
});
