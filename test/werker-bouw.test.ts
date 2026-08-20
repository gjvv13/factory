import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BOUW_JSON_SCHEMA,
  BOUWER_TOEGESTAAN,
  BOUWER_VERBODEN,
  draaiBouwer,
} from '../src/werker.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer } from './helpers.js';

/**
 * Het contract met de `claude`-CLI voor een bouw-run. Geen Pact: dat is een dienst van
 * derden, dus de koppeling wordt vastgelegd met een opgenomen respons plus een schema
 * (zie de coding-guidelines). De **envelop** in deze fixtures is opgenomen uit echte
 * runs van 2026-08-19/20; het bouw-verdict erin is met de hand geschreven, want er heeft
 * nog geen bouw-run gedraaid. Dat verschil staat hier expliciet, zodat niemand het voor
 * een opname aanziet die het niet is.
 */
function envelop(naam: string): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, 'fixtures', `${naam}.json`), 'utf8');
}

const OPDRACHT = {
  prompt: 'bouw #91',
  werkmap: '/w/factory-wt/91',
  sessie: '7c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  budgetUsd: 10,
  model: 'claude-opus-4-6',
};

describe('draaiBouwer', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  function metEnvelop(naam: string, code = 0) {
    const opnemer = maakUitvoerderOpnemer(() => ({ code, stdout: envelop(naam) }));
    stelUitvoerderIn(opnemer.uitvoerder);
    return opnemer;
  }

  it('leest een geslaagde bouw met bewijs per criterium', () => {
    metEnvelop('claude-bouw-klaar');

    const uitkomst = draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.kosten).toBeCloseTo(4.812);
    expect(uitkomst.beurten).toBe(31);
    const verdict = uitkomst.verdict;
    expect(verdict?.uitkomst === 'klaar' && verdict.criteria).toHaveLength(2);
  });

  it('weigert een criterium zonder bewijs als klaar', () => {
    metEnvelop('claude-bouw-geen-bewijs');

    const uitkomst = draaiBouwer(OPDRACHT);

    // Dit is de hele reden dat het schema bestaat: een leeg `bewijs` mag niet als
    // afgevinkt criterium doorgaan. Het is een mislukking, geen halve overwinning.
    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toMatch(/bewijs/);
    expect(uitkomst.verdict).toBeUndefined();
  });

  it('herkent is_error bij exitcode 0 als mislukt', () => {
    // De gemeten val uit #153: de exitcode zegt niets, het verdict alles.
    metEnvelop('claude-bouw-fout');

    const uitkomst = draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toMatch(/poort niet groen/);
    expect(uitkomst.weigeringen).toBe(1);
  });

  it('roept claude aan met het bouw-schema en de bouw-rechten', () => {
    const { aanroepen } = metEnvelop('claude-bouw-klaar');

    draaiBouwer(OPDRACHT);

    const args = aanroepen[0]?.argumenten ?? [];
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(BOUW_JSON_SCHEMA));
    // De toestemmingslijst ís de grens; een verbodslijst alleen is niet genoeg (#153).
    for (const gereedschap of BOUWER_TOEGESTAAN) {
      expect(args).toContain(gereedschap);
    }
    for (const gereedschap of BOUWER_VERBODEN) {
      expect(args).toContain(gereedschap);
    }
  });

  it('mag lezen en een tmp-map maken, zonder extra macht', () => {
    // De negen weigeringen van de eerste bouw-run (#87) waren allemaal hulpmiddelen bij
    // zijn eigen toets. Weigeren kostte beurten en leverde geen veiligheid op, want
    // `Write` en `Edit` staan al op de lijst.
    for (const gereedschap of [
      'Bash(ls:*)',
      'Bash(cat:*)',
      'Bash(grep:*)',
      'Bash(echo:*)',
      'Bash(mkdir:*)',
      'Bash(mktemp:*)',
    ]) {
      expect(BOUWER_TOEGESTAAN as readonly string[]).toContain(gereedschap);
    }
  });

  it('houdt rm, git -C, git push en gh pr buiten de toestemmingslijst', () => {
    // Deze vier zijn geen gemak maar macht: `rm -rf <pad>` kan de spiegel van een andere
    // app wissen, en `git -C <pad> push` omzeilt de grens tussen voorstellen en landen.
    // Een latere uitbreiding mag die grens niet stil oprekken.
    const lijst = BOUWER_TOEGESTAAN as readonly string[];
    expect(lijst.some((g) => g.startsWith('Bash(rm'))).toBe(false);
    expect(lijst.some((g) => g.startsWith('Bash(git -C'))).toBe(false);
    expect(lijst.some((g) => g.includes('push'))).toBe(false);
    expect(lijst.some((g) => g.includes('gh pr'))).toBe(false);
  });

  it('laat de refine-werker ongemoeid', () => {
    // `--soort bouw` mag de bestaande refine-aanroep niet van rechten of schema
    // veranderen; dat zou #153 stil omgooien.
    expect(BOUWER_TOEGESTAAN).toContain('Write');
    expect(BOUWER_VERBODEN).toContain('Bash(git push:*)');
  });
});
