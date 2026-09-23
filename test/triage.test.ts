import { describe, expect, it } from 'vitest';

import { GebruikersFout } from '../src/shell.js';
import { TRIAGE_DOELKOLOM, TRIAGE_LABELS, triage, triagePlan } from '../src/commands/triage.js';

// ---------------------------------------------------------------------------
// triagePlan (puur): welke labels ontbreken er nog (#783)
// ---------------------------------------------------------------------------
describe('triagePlan', () => {
  it('zet alle drie de labels op een leeg issue', () => {
    expect(triagePlan([]).teZetten).toEqual(['type:bug', 'fastlane', 'auto-merge-ok']);
  });

  it('zet niets als alle drie de labels er al zijn (idempotent)', () => {
    expect(triagePlan(['type:bug', 'fastlane', 'auto-merge-ok']).teZetten).toEqual([]);
  });

  it('vult alleen de ontbrekende labels aan', () => {
    expect(triagePlan(['type:bug']).teZetten).toEqual(['fastlane', 'auto-merge-ok']);
  });

  it('laat vreemde labels ongemoeid en telt ze niet mee', () => {
    expect(triagePlan(['prioriteit:hoog', 'fastlane']).teZetten).toEqual([
      'type:bug',
      'auto-merge-ok',
    ]);
  });

  it('de doelkolom is de refine-wachtrij (bug wordt eerst bug-exempt gerefined, #782/#784)', () => {
    expect(TRIAGE_DOELKOLOM).toBe('Klaar voor technische refinement');
    expect(TRIAGE_LABELS).toEqual(['type:bug', 'fastlane', 'auto-merge-ok']);
  });
});

// ---------------------------------------------------------------------------
// triage — argument-validatie (vóór enige gh-I/O)
// ---------------------------------------------------------------------------
describe('triage argument-validatie', () => {
  it('faalt zonder issuenummer', () => {
    expect(() => {
      triage(undefined);
    }).toThrow(GebruikersFout);
    expect(() => {
      triage(undefined);
    }).toThrow(/Gebruik: factory triage/);
  });

  it('faalt op een niet-numeriek argument', () => {
    expect(() => {
      triage('abc');
    }).toThrow(GebruikersFout);
  });

  it('faalt op een niet-positief nummer', () => {
    expect(() => {
      triage('0');
    }).toThrow(/Gebruik: factory triage/);
    expect(() => {
      triage('-5');
    }).toThrow(GebruikersFout);
  });
});
