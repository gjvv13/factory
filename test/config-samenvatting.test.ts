import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSamenvatting, toonGeladenConfig } from '../src/env-herstart.js';

const GEHEIME_WAARDE = 'super-secret-123';

/** App met een environments-map en een prod.env + prod.secrets.env. */
function maakAppMetEnv(): string {
  const appDir = mkdtempSync(path.join(os.tmpdir(), 'factory-config-'));
  const map = path.join(appDir, 'environments');
  mkdirSync(map, { recursive: true });
  writeFileSync(
    path.join(map, 'prod.env'),
    // WHISPER_MODEL is bewust leeg, om de lege-waarde-waarschuwing te toetsen.
    'DATABASE_FILE=data/prod.sqlite\nLOG_LEVEL=info\nWHISPER_MODEL=\n',
  );
  writeFileSync(path.join(map, 'prod.secrets.env'), `WHISPER_API_KEY=${GEHEIME_WAARDE}\n`);
  return appDir;
}

describe('configSamenvatting', () => {
  it('geeft de gesorteerde sleutelnamen, bestanden en lege sleutels — geen waarden', () => {
    const appDir = maakAppMetEnv();
    const s = configSamenvatting(appDir, 'prod');

    expect(s.sleutels).toEqual(['DATABASE_FILE', 'LOG_LEVEL', 'WHISPER_API_KEY', 'WHISPER_MODEL']);
    expect(s.legeSleutels).toEqual(['WHISPER_MODEL']);
    expect(s.bestanden).toEqual(['prod.env', 'prod.secrets.env']);
    expect(s.map).toBe(path.join(appDir, 'environments'));
  });

  it('noemt alleen bestaande env-bestanden', () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), 'factory-config-'));
    mkdirSync(path.join(appDir, 'environments'), { recursive: true });
    writeFileSync(path.join(appDir, 'environments', 'acc.env'), 'LOG_LEVEL=debug\n');

    const s = configSamenvatting(appDir, 'acc');
    expect(s.bestanden).toEqual(['acc.env']);
    expect(s.legeSleutels).toEqual([]);
  });
});

describe('toonGeladenConfig', () => {
  let uitvoer: string;

  beforeEach(() => {
    uitvoer = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      uitvoer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toont sleutelnamen, bestanden en een waarschuwing bij een lege waarde, maar nooit een waarde', () => {
    const appDir = maakAppMetEnv();
    toonGeladenConfig(appDir, 'prod');

    expect(uitvoer).toContain('WHISPER_API_KEY');
    expect(uitvoer).toContain('prod.env');
    expect(uitvoer).toContain('prod.secrets.env');
    expect(uitvoer).toMatch(/WHISPER_MODEL is leeg/);
    // De geheime wáárde mag nooit in de uitvoer belanden.
    expect(uitvoer).not.toContain(GEHEIME_WAARDE);
  });

  it('waarschuwt als er geen env-bestanden zijn', () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), 'factory-config-'));
    mkdirSync(path.join(appDir, 'environments'), { recursive: true });

    toonGeladenConfig(appDir, 'prod');
    expect(uitvoer).toMatch(/geen env-bestanden gevonden/);
  });
});
