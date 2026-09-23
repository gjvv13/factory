import { describe, expect, it } from 'vitest';

import { FASTLANE_LABEL, type BacklogItem } from '../src/board.js';
import {
  fastlaneWachtrij,
  landtViaFastlanePoort,
  redenBuitenFastlane,
} from '../src/commands/orkestreer-bouw.js';
import { TRIAGE_LABELS } from '../src/commands/triage.js';

/**
 * De sluitslice van epic #767 (#784): een getrieerde bug stroomt onbemand van
 * _Klaar voor technische refinement_ naar Done. Deze test pint de twee schakels vast
 * die #784 raakt — de selectie (`fastlaneWachtrij`) en de landing
 * (`landtViaFastlanePoort`) — plus de uitsluitingen die de envelop bewaken. De
 * bordovergangen zelf (rondAf → Klaar voor Bouwen, deploy → Uitrollen, release → Done)
 * zijn bestaand gedrag en elders getest; hier borgen we dat de keten op de schone gate
 * sluit en niet op de lossere #401-poort.
 */
function bug(velden: Partial<BacklogItem> = {}): BacklogItem {
  return {
    issue: 1,
    titel: 'Een kapotte knop',
    kolom: 'Klaar voor Bouwen',
    aangemaakt: '2026-09-23T00:00:00Z',
    labels: [...TRIAGE_LABELS],
    app: 'assistant',
    ...velden,
  };
}

describe('nacht-fastlane-keten — selectie (#784)', () => {
  it('selecteert een getrieerde bug op Klaar voor Bouwen', () => {
    const rij = fastlaneWachtrij([bug()]);
    expect(rij.map((item) => item.issue)).toEqual([1]);
  });

  it('een getrieerde bug draagt alle drie de triage-labels (#783)', () => {
    // De triage-labels zijn de toegangskaart tot de baan; fastlaneWachtrij accepteert al
    // op type:bug, maar de keten leunt op auto-merge-ok voor de landing hieronder.
    expect(TRIAGE_LABELS).toContain('type:bug');
    expect(redenBuitenFastlane(bug())).toBeUndefined();
  });

  it('sluit een attended-bug, een child-slice en een niet-Klaar-voor-Bouwen-item uit', () => {
    const uitgesloten = fastlaneWachtrij([
      bug({ issue: 2, labels: [...TRIAGE_LABELS, 'attended'] }),
      bug({ issue: 3, ouder: 99 }),
      bug({ issue: 4, kolom: 'Bouwen' }),
    ]);
    expect(uitgesloten).toEqual([]);
  });
});

describe('nacht-fastlane-keten — landing op de schone gate (#784, #767-besluit 4)', () => {
  it('de autonome nacht-fastlane landt NIET op de #401-poort', () => {
    // autonoom === true → geen fastlane:true aan inleveren; de #573-schone-gate
    // (auto-merge-ok + schone review) is de enige trekker.
    expect(landtViaFastlanePoort('fastlane', true)).toBe(false);
  });

  it('de interactieve --baan fastlane houdt de #401-poort (ongewijzigd)', () => {
    expect(landtViaFastlanePoort('fastlane', undefined)).toBe(true);
  });

  it('een gewoon item landt ook op de #573-gate', () => {
    expect(landtViaFastlanePoort(undefined, undefined)).toBe(false);
    expect(landtViaFastlanePoort('gewoon', undefined)).toBe(false);
  });

  it('autonoom overrulet de baan, niet andersom', () => {
    // Ook als de baan fastlane is, wint autonoom: de nacht landt altijd op de schone gate.
    expect(landtViaFastlanePoort('fastlane', true)).toBe(false);
    expect(landtViaFastlanePoort(undefined, true)).toBe(false);
  });
});

// Sanity: FASTLANE_LABEL is de task-toegangskaart, maar een bug kwalificeert zonder.
describe('nacht-fastlane-keten — task vs bug', () => {
  it('een getrieerde task (fastlane-label) komt ook in de rij', () => {
    const rij = fastlaneWachtrij([bug({ labels: ['type:task', FASTLANE_LABEL, 'auto-merge-ok'] })]);
    expect(rij.map((item) => item.issue)).toEqual([1]);
  });
});
