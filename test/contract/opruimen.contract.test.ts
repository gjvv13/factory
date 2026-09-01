import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseReleasePrList,
  parseWorktreeList,
  vergelijkVersies,
} from '../../src/commands/opruimen.js';

const fixture = (naam: string): string =>
  readFileSync(resolve(__dirname, '../fixtures/contract', naam), 'utf8');

describe('parseWorktreeList (contract)', () => {
  it('parseert opgenomen `git worktree list --porcelain` correct', () => {
    const entries = parseWorktreeList(fixture('git-worktree-list.txt'));

    expect(entries).toHaveLength(4);

    expect(entries[0]).toEqual({
      pad: '/Users/gjvv/Documents/Software/factory',
      branch: 'main',
    });

    expect(entries[1]).toEqual({
      pad: '/Users/gjvv/OrkestratorWerk/factory-wt/42',
      branch: 'slice/42-1',
    });

    expect(entries[2]).toEqual({
      pad: '/Users/gjvv/OrkestratorWerk/factory-wt/99',
      branch: 'slice/99-2',
    });

    // Detached worktree heeft geen branch.
    expect(entries[3]).toEqual({
      pad: '/Users/gjvv/OrkestratorWerk/factory-wt/detached',
      branch: undefined,
    });
  });

  it('geeft een lege lijst bij lege invoer', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('parseReleasePrList (contract)', () => {
  it('parseert opgenomen `gh pr list --json` correct', () => {
    const prs = parseReleasePrList(fixture('gh-pr-list-release.json'));

    expect(prs).toHaveLength(3);

    expect(prs[0]).toEqual({
      number: 480,
      headRefName: 'release/v1.15.92',
      mergeable: 'CONFLICTING',
      title: 'release: v1.15.92',
    });

    expect(prs[1]).toEqual({
      number: 475,
      headRefName: 'release/v1.15.89',
      mergeable: 'MERGEABLE',
      title: 'release: v1.15.89',
    });

    expect(prs[2]).toEqual({
      number: 460,
      headRefName: 'release/v1.14.80',
      mergeable: 'UNKNOWN',
      title: 'release: v1.14.80',
    });
  });

  it('geeft een lege lijst bij een leeg JSON-array', () => {
    expect(parseReleasePrList('[]')).toEqual([]);
  });
});

describe('vergelijkVersies (contract)', () => {
  it('herkent een lagere versie', () => {
    expect(vergelijkVersies('1.14.80', '1.15.92')).toBeLessThan(0);
  });

  it('herkent een gelijke versie', () => {
    expect(vergelijkVersies('1.15.92', '1.15.92')).toBe(0);
  });

  it('herkent een hogere versie', () => {
    expect(vergelijkVersies('1.16.0', '1.15.92')).toBeGreaterThan(0);
  });

  it('handelt v-prefix af', () => {
    expect(vergelijkVersies('v1.15.92', '1.15.92')).toBe(0);
  });

  it('vergelijkt major correct', () => {
    expect(vergelijkVersies('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });
});
