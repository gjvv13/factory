import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leesDekkingsConfig } from '../src/dekking-config.js';
import { GebruikersFout } from '../src/shell.js';

function maakMap(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-dekking-config-'));
}

function schrijfJson(map: string, bestand: string, inhoud: unknown): void {
  writeFileSync(path.join(map, bestand), JSON.stringify(inhoud, null, 2));
}

describe('leesDekkingsConfig', () => {
  it('vindt config uit factory.json', () => {
    const map = maakMap();
    schrijfJson(map, 'factory.json', {
      naam: 'proef',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: '~/AppEnvs/proef',
      dekkingsMinimum: 80,
      dekkingsRatchet: 'blokkeer',
      dekkingsTolerantie: 1,
    });
    const config = leesDekkingsConfig(map);
    expect(config).toBeDefined();
    expect(config!.dir).toBe(map);
    expect(config!.dekkingsMinimum).toBe(80);
    expect(config!.dekkingsRatchet).toBe('blokkeer');
    expect(config!.dekkingsTolerantie).toBe(1);
  });

  it('valt terug op dekking.json zonder factory.json', () => {
    const map = maakMap();
    schrijfJson(map, 'dekking.json', {
      dekkingsRatchet: 'waarschuw',
      dekkingsTolerantie: 0.3,
    });
    const config = leesDekkingsConfig(map);
    expect(config).toBeDefined();
    expect(config!.dir).toBe(map);
    expect(config!.dekkingsRatchet).toBe('waarschuw');
    expect(config!.dekkingsTolerantie).toBe(0.3);
    expect(config!.dekkingsMinimum).toBeUndefined();
  });

  it('geeft undefined zonder beide bestanden', () => {
    expect(leesDekkingsConfig(maakMap())).toBeUndefined();
  });

  it('factory.json gaat voor op dekking.json als beide bestaan', () => {
    const map = maakMap();
    schrijfJson(map, 'factory.json', {
      naam: 'proef',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: '~/AppEnvs/proef',
      dekkingsRatchet: 'blokkeer',
    });
    schrijfJson(map, 'dekking.json', {
      dekkingsRatchet: 'uit',
    });
    const config = leesDekkingsConfig(map);
    expect(config!.dekkingsRatchet).toBe('blokkeer');
  });

  it('gooit een GebruikersFout bij ongeldige dekking.json', () => {
    const map = maakMap();
    schrijfJson(map, 'dekking.json', {
      dekkingsRatchet: 'onbekend',
    });
    expect(() => leesDekkingsConfig(map)).toThrow(GebruikersFout);
  });

  it('past defaults toe op een minimale dekking.json', () => {
    const map = maakMap();
    schrijfJson(map, 'dekking.json', {});
    const config = leesDekkingsConfig(map);
    expect(config).toBeDefined();
    expect(config!.dekkingsRatchet).toBe('waarschuw');
    expect(config!.dekkingsTolerantie).toBe(0.5);
  });
});
