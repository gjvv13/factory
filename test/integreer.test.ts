import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { integreer } from '../src/commands/integreer.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

const LOCK = path.join(os.tmpdir(), 'factory-integreer.lock');

function ghArgs(aanroepen: ProcesAanroep[]): string[][] {
  return aanroepen.filter((a) => a.commando === 'gh').map((a) => a.argumenten);
}

/** Bepaler: één PR in de wachtrij met een gegeven mergeable/checks-status. */
function metPr(nummer: number, status: object): UitkomstBepaler {
  return ({ commando, argumenten }) => {
    if (commando !== 'gh') return {};
    if (argumenten[1] === 'list') {
      return { stdout: JSON.stringify([{ number: nummer, createdAt: '2026-08-15T10:00:00Z' }]) };
    }
    if (argumenten[1] === 'view') return { stdout: JSON.stringify(status) };
    return {};
  };
}

const GROEN = {
  mergeable: 'MERGEABLE',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
};

describe('integreer', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    if (existsSync(LOCK)) rmSync(LOCK);
  });

  afterEach(() => {
    herstelUitvoerder();
    if (existsSync(LOCK)) rmSync(LOCK);
    vi.restoreAllMocks();
  });

  it('lege wachtrij: merget niets', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(); // pr list → leeg
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen).some((a) => a[1] === 'merge')).toBe(false);
  });

  it('groene, mergeable PR wordt gemerged', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metPr(7, GROEN));
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen)).toContainEqual(['pr', 'merge', '7', '--merge']);
  });

  it('rode poort → kick-back (comment + label eraf), geen merge', () => {
    const status = {
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metPr(7, status));
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen).some((a) => a[1] === 'comment')).toBe(true);
    expect(ghArgs(aanroepen)).toContainEqual(['pr', 'edit', '7', '--remove-label', 'wachtrij']);
    expect(ghArgs(aanroepen).some((a) => a[1] === 'merge')).toBe(false);
  });

  it('merge-conflict → kick-back, geen merge', () => {
    const status = {
      mergeable: 'CONFLICTING',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metPr(7, status));
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen)).toContainEqual(['pr', 'edit', '7', '--remove-label', 'wachtrij']);
    expect(ghArgs(aanroepen).some((a) => a[1] === 'merge')).toBe(false);
  });

  it('poort draait nog → wachten (niet mergen, geen kick-back)', () => {
    const status = { mergeable: 'MERGEABLE', statusCheckRollup: [{ status: 'IN_PROGRESS' }] };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metPr(7, status));
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen).some((a) => a[1] === 'merge')).toBe(false);
    expect(ghArgs(aanroepen).some((a) => a[1] === 'comment')).toBe(false);
  });

  it('een bezet slot: de run wordt overgeslagen', () => {
    writeFileSync(LOCK, String(process.pid)); // vers slot
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metPr(7, GROEN));
    stelUitvoerderIn(uitvoerder);

    integreer();
    expect(ghArgs(aanroepen).length).toBe(0); // niets aangeraakt
  });
});
