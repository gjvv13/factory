import http from 'node:http';
import https from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// De guard wordt als setup-bestand geladen; hier importeren we hem handmatig
// zodat de patches actief zijn in deze test-suite.
// ---------------------------------------------------------------------------
await import('../configs/e2e-network-guard.js');

// ---------------------------------------------------------------------------
// 1. fetch — geblokkeerd naar buiten, toegestaan naar localhost
// ---------------------------------------------------------------------------
describe('e2e-network-guard · fetch', () => {
  it('blokkeert fetch naar een extern adres', () => {
    expect(() => {
      // De guard gooit synchroon vóór het netwerk wordt geraakt, dus we hoeven
      // niet op de promise te wachten.
      void globalThis.fetch('https://example.com');
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('blokkeert fetch naar een extern adres met URL-object', () => {
    expect(() => {
      void globalThis.fetch(new URL('https://httpbin.org/get'));
    }).toThrow(/e2e-network-guard.*httpbin\.org/);
  });

  it('staat fetch naar 127.0.0.1 toe', async () => {
    // We verwachten een ECONNREFUSED of iets dergelijks — niet de guard-fout.
    // Het punt is dat de guard niet gooit.
    const result = globalThis.fetch('http://127.0.0.1:1/health');
    await expect(result).rejects.not.toThrow(/e2e-network-guard/);
  });

  it('staat fetch naar localhost toe', async () => {
    const result = globalThis.fetch('http://localhost:1/health');
    await expect(result).rejects.not.toThrow(/e2e-network-guard/);
  });

  it('staat fetch naar [::1] toe', async () => {
    const result = globalThis.fetch('http://[::1]:1/health');
    await expect(result).rejects.not.toThrow(/e2e-network-guard/);
  });
});

// ---------------------------------------------------------------------------
// 2. http.request / http.get — geblokkeerd naar buiten
// ---------------------------------------------------------------------------
describe('e2e-network-guard · http', () => {
  it('blokkeert http.request naar een extern adres (string)', () => {
    expect(() => {
      http.request('http://example.com');
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('blokkeert http.get naar een extern adres (string)', () => {
    expect(() => {
      http.get('http://example.com');
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('blokkeert http.request naar een extern adres (opties)', () => {
    expect(() => {
      http.request({ hostname: 'example.com', port: 80, path: '/' });
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('blokkeert http.request naar een extern adres (URL-object)', () => {
    expect(() => {
      http.request(new URL('http://example.com'));
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('staat http.request naar 127.0.0.1 toe', () => {
    // Maak het verzoek aan en vernietig het meteen — we testen alleen dat de
    // guard niet gooit, niet dat de verbinding slaagt.
    const req = http.request({ hostname: '127.0.0.1', port: 1, path: '/' });
    req.on('error', () => {
      /* verwacht: ECONNREFUSED */
    });
    req.destroy();
  });

  it('staat http.request naar localhost toe', () => {
    const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
    req.on('error', () => {
      /* verwacht: ECONNREFUSED */
    });
    req.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. https.request / https.get — geblokkeerd naar buiten
// ---------------------------------------------------------------------------
describe('e2e-network-guard · https', () => {
  it('blokkeert https.request naar een extern adres', () => {
    expect(() => {
      https.request('https://example.com');
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('blokkeert https.get naar een extern adres', () => {
    expect(() => {
      https.get('https://example.com');
    }).toThrow(/e2e-network-guard.*example\.com/);
  });

  it('staat https.request naar localhost toe', () => {
    const req = https.request({ hostname: 'localhost', port: 1, path: '/' });
    req.on('error', () => {
      /* verwacht: ECONNREFUSED of TLS-fout */
    });
    req.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. e2eTestConfig bevat setupFiles en retry
// ---------------------------------------------------------------------------
describe('e2eTestConfig · hermetische gate', () => {
  it('bevat de network-guard in setupFiles', async () => {
    const { e2eTestConfig } = await import('../configs/vitest-e2e.js');
    const config = e2eTestConfig();

    expect(config.test.setupFiles).toBeDefined();
    expect(config.test.setupFiles).toHaveLength(1);
    expect(config.test.setupFiles[0]).toContain('e2e-network-guard.js');
  });

  it('zet retry op 1', async () => {
    const { e2eTestConfig } = await import('../configs/vitest-e2e.js');
    const config = e2eTestConfig();

    expect(config.test.retry).toBe(1);
  });

  it('is overridable: eigen setupFiles vervangt de guard', async () => {
    const { e2eTestConfig } = await import('../configs/vitest-e2e.js');
    const config = e2eTestConfig({ setupFiles: ['mijn-eigen-setup.js'] });

    expect(config.test.setupFiles).toEqual(['mijn-eigen-setup.js']);
  });

  it('is overridable: eigen retry vervangt de default', async () => {
    const { e2eTestConfig } = await import('../configs/vitest-e2e.js');
    const config = e2eTestConfig({ retry: 3 });

    expect(config.test.retry).toBe(3);
  });

  it('behoudt de bestaande preset-waarden', async () => {
    const { e2eTestConfig } = await import('../configs/vitest-e2e.js');
    const config = e2eTestConfig();

    expect(config.test.name).toBe('e2e');
    expect(config.test.include).toEqual(['app/test/e2e/**/*.test.ts']);
    expect(config.test.fileParallelism).toBe(false);
    expect(config.test.globalSetup).toEqual(['app/test/e2e/global-setup.ts']);
    expect(config.test.testTimeout).toBe(30_000);
    expect(config.test.hookTimeout).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// 5. package.json exporteert de guard
// ---------------------------------------------------------------------------
describe('package.json · e2e-network-guard export', () => {
  it('exporteert ./e2e-network-guard', async () => {
    const pkgPath = resolve(__dirname, '..', 'package.json');
    const { default: fs } = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.exports['./e2e-network-guard']).toEqual({
      types: './configs/e2e-network-guard.d.ts',
      default: './configs/e2e-network-guard.js',
    });
  });
});
