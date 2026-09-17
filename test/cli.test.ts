import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { eigenVersie } from '../src/commands/orkestreer.js';

/**
 * `factory --version` (#695/#707): de apps consumeren de factory als globaal
 * geïnstalleerde CLI, dus moet de bin zijn eigen versie kunnen tonen — de CI logt
 * dit voor traceerbaarheid. De waarde komt uit `eigenVersie()` (package.json).
 */
describe('factory --version', () => {
  async function versieUitvoer(vlag: string): Promise<string> {
    const stukken: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stukken.push(String(chunk));
      return true;
    });
    try {
      await main([vlag]);
    } finally {
      spy.mockRestore();
    }
    return stukken.join('');
  }

  it('print het eigen versienummer bij --version', async () => {
    expect(await versieUitvoer('--version')).toBe(`${eigenVersie()}\n`);
  });

  it('doet hetzelfde bij de korte vlag -v', async () => {
    expect(await versieUitvoer('-v')).toBe(`${eigenVersie()}\n`);
  });

  it('doet hetzelfde bij het kale woord version', async () => {
    expect(await versieUitvoer('version')).toBe(`${eigenVersie()}\n`);
  });
});
