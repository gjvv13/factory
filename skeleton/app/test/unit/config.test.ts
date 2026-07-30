import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('config', () => {
  it('valt terug op veilige standaarden', () => {
    const config = loadConfig({});
    expect(config.environment).toBe('dev');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3001);
    expect(config.channel).toBe('http');
  });

  it('leest de versie uit package.json', () => {
    expect(loadConfig({}).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('weigert een onbekende omgeving', () => {
    expect(() => loadConfig({ FACTORY_ENV: 'staging' })).toThrow(/Ongeldige omgevingsconfiguratie/);
  });

  it('weigert een poort buiten het bereik', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  it('laat :memory: ongemoeid maar maakt andere paden absoluut', () => {
    expect(loadConfig({ DATABASE_FILE: ':memory:' }).databaseFile).toBe(':memory:');
    expect(loadConfig({ DATABASE_FILE: 'data/acc.sqlite' }).databaseFile).toMatch(
      /\/data\/acc\.sqlite$/,
    );
  });
});
