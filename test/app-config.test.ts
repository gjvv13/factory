import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isOmgeving,
  leesAppConfig,
  leesOmgevingsWaarden,
  pm2NaamVan,
  vereisOmgeving,
  werkmapVan,
  zoekAppDir,
} from '../src/app-config.js';

function maakApp(inhoud: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
  writeFileSync(path.join(dir, 'factory.json'), JSON.stringify(inhoud));
  return dir;
}

const geldig = {
  naam: 'assistant',
  poorten: { dev: 3001, acc: 3002, prod: 3000 },
  envRoot: '~/AppEnvs/assistant',
  backlog: '../factory/backlog/assistant',
};

describe('app-config', () => {
  it('leest een geldige factory.json en maakt de paden absoluut', () => {
    const dir = maakApp(geldig);
    const config = leesAppConfig(dir);

    expect(config.naam).toBe('assistant');
    expect(config.envRootPad).toBe(path.join(os.homedir(), 'AppEnvs', 'assistant'));
    expect(path.isAbsolute(config.backlogPad)).toBe(true);
    expect(config.backlogPad.endsWith(path.join('factory', 'backlog', 'assistant'))).toBe(true);
  });

  it('weigert een naam met hoofdletters of spaties', () => {
    const dir = maakApp({ ...geldig, naam: 'Mijn App' });
    expect(() => leesAppConfig(dir)).toThrow(/naam/);
  });

  it('weigert een poort buiten het bereik', () => {
    const dir = maakApp({ ...geldig, poorten: { dev: 0, acc: 3002, prod: 3000 } });
    expect(() => leesAppConfig(dir)).toThrow(/poorten\.dev/);
  });

  it('vindt de app-map ook vanuit een submap', () => {
    const dir = maakApp(geldig);
    const diep = path.join(dir, 'app', 'src', 'core');
    mkdirSync(diep, { recursive: true });

    expect(zoekAppDir(diep)).toBe(dir);
  });

  it('geeft undefined als er geen factory.json boven de map staat', () => {
    expect(zoekAppDir(os.tmpdir())).toBeUndefined();
  });

  it('wijst dev naar de repo zelf en acc en prod naar de envRoot', () => {
    const dir = maakApp(geldig);
    const config = leesAppConfig(dir);

    expect(werkmapVan(config, 'dev')).toBe(dir);
    expect(werkmapVan(config, 'acc')).toBe(path.join(config.envRootPad, 'acc'));
    expect(werkmapVan(config, 'prod')).toBe(path.join(config.envRootPad, 'prod'));
  });

  it('maakt pm2-namen met de applicatienaam ervoor', () => {
    const config = leesAppConfig(maakApp(geldig));
    expect(pm2NaamVan(config, 'prod')).toBe('assistant-prod');
  });

  it('herkent geldige omgevingen en wijst de rest af', () => {
    expect(isOmgeving('acc')).toBe(true);
    expect(isOmgeving('staging')).toBe(false);
    expect(isOmgeving(undefined)).toBe(false);
    expect(() => vereisOmgeving('staging')).toThrow(/dev, acc, prod/);
  });

  it('leest de omgevingswaarden met de secrets eroverheen', () => {
    const dir = maakApp(geldig);
    const envDir = path.join(dir, 'environments');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      path.join(envDir, 'prod.env'),
      '# productie\nFACTORY_ENV=prod\nDATABASE_FILE=data/prod.sqlite\nLOG_LEVEL=warn\n',
    );
    writeFileSync(
      path.join(envDir, 'prod.secrets.env'),
      'WHATSAPP_ALLOWLIST=316@c.us\nLOG_LEVEL=info\n',
    );

    const waarden = leesOmgevingsWaarden(dir, 'prod');

    expect(waarden.DATABASE_FILE).toBe('data/prod.sqlite');
    // De secrets overrulen het basisbestand.
    expect(waarden.LOG_LEVEL).toBe('info');
    // Waarden met bijzondere tekens blijven heel; commentaar wordt genegeerd.
    expect(waarden.WHATSAPP_ALLOWLIST).toBe('316@c.us');
    expect(waarden).not.toHaveProperty('# productie');
  });

  it('geeft een lege set als er geen env-bestanden zijn', () => {
    const dir = maakApp(geldig);
    expect(leesOmgevingsWaarden(dir, 'prod')).toEqual({});
  });
});
