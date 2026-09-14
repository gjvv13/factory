import { describe, expect, it } from 'vitest';
import { BEKENDE_FAALKLASSEN, isLockfileDrift } from '../src/playbooks.js';

describe('BEKENDE_FAALKLASSEN', () => {
  it('bevat de drie bekende faalklassen', () => {
    const ids = BEKENDE_FAALKLASSEN.map((f) => f.id);
    expect(ids).toEqual(['node-drift', 'lockfile-drift', 'env-stale']);
  });

  it('heeft een naam en beschrijving per klasse', () => {
    for (const klasse of BEKENDE_FAALKLASSEN) {
      expect(klasse.naam.length).toBeGreaterThan(0);
      expect(klasse.beschrijving.length).toBeGreaterThan(0);
    }
  });
});

describe('isLockfileDrift', () => {
  it('herkent ERR_PNPM_OUTDATED_LOCKFILE', () => {
    expect(
      isLockfileDrift(
        'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date',
      ),
    ).toBe(true);
  });

  it('herkent ERR_PNPM_FROZEN_LOCKFILE', () => {
    expect(
      isLockfileDrift(
        'ERR_PNPM_FROZEN_LOCKFILE  Cannot perform this operation with "frozen-lockfile" enabled',
      ),
    ).toBe(true);
  });

  it('weigert een DNS-fout', () => {
    expect(isLockfileDrift('getaddrinfo ENOTFOUND registry.npmjs.org')).toBe(false);
  });

  it('weigert een generieke fout', () => {
    expect(isLockfileDrift('Something went wrong')).toBe(false);
  });

  it('geeft false op een lege string', () => {
    expect(isLockfileDrift('')).toBe(false);
  });
});
