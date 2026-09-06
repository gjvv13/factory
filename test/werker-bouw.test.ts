import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_BOUWER,
  AGENT_REVIEWER,
  BOUW_JSON_SCHEMA,
  draaiBouwer,
  draaiReviewer,
  REVIEW_JSON_SCHEMA,
} from '../src/werker.js';
import { herstelAsyncUitvoerder, stelAsyncUitvoerderIn } from '../src/shell.js';
import { maakAsyncUitvoerderOpnemer } from './helpers.js';
import { leesAgentFrontmatter } from './agent-definitie.js';

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
  agent: AGENT_BOUWER,
};

describe('draaiBouwer', () => {
  afterEach(() => {
    herstelAsyncUitvoerder();
  });

  function metEnvelop(naam: string, code = 0) {
    const opnemer = maakAsyncUitvoerderOpnemer(() => ({ code, stdout: envelop(naam) }));
    stelAsyncUitvoerderIn(opnemer.uitvoerder);
    return opnemer;
  }

  it('leest een geslaagde bouw met bewijs per criterium', async () => {
    metEnvelop('claude-bouw-klaar');

    const uitkomst = await draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.kosten).toBeCloseTo(4.812);
    expect(uitkomst.beurten).toBe(31);
    const verdict = uitkomst.verdict;
    expect(verdict?.uitkomst === 'klaar' && verdict.criteria).toHaveLength(2);
  });

  it('weigert een criterium zonder bewijs als klaar', async () => {
    metEnvelop('claude-bouw-geen-bewijs');

    const uitkomst = await draaiBouwer(OPDRACHT);

    // Dit is de hele reden dat het schema bestaat: een leeg `bewijs` mag niet als
    // afgevinkt criterium doorgaan. Het is een mislukking, geen halve overwinning.
    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toMatch(/bewijs/);
    expect(uitkomst.verdict).toBeUndefined();
  });

  it('herkent is_error bij exitcode 0 als mislukt', async () => {
    // De gemeten val uit #153: de exitcode zegt niets, het verdict alles.
    metEnvelop('claude-bouw-fout');

    const uitkomst = await draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toMatch(/poort niet groen/);
    expect(uitkomst.weigeringen).toBe(1);
  });

  it('roept claude aan met het bouw-schema en --agent bouwer', async () => {
    const { aanroepen } = metEnvelop('claude-bouw-klaar');

    await draaiBouwer(OPDRACHT);

    const args = aanroepen[0]?.argumenten ?? [];
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(BOUW_JSON_SCHEMA));
    // De agent-definitie is de bron; de werker geeft haar grens expliciet mee (#547).
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe(AGENT_BOUWER);
    expect(args).toContain('--allowedTools');
    expect(args).toContain('--disallowedTools');
  });

  it('mag lezen en een tmp-map maken, zonder extra macht', () => {
    // De negen weigeringen van de eerste bouw-run (#87) waren allemaal hulpmiddelen bij
    // zijn eigen toets. Weigeren kostte beurten en leverde geen veiligheid op, want
    // `Write` en `Edit` staan al op de lijst.
    const def = leesAgentFrontmatter(AGENT_BOUWER);
    for (const gereedschap of [
      'Bash(ls:*)',
      'Bash(cat:*)',
      'Bash(grep:*)',
      'Bash(echo:*)',
      'Bash(mkdir:*)',
      'Bash(mktemp:*)',
    ]) {
      expect(def.allowedTools).toContain(gereedschap);
    }
  });

  it('houdt rm, git -C, git push en gh pr buiten de toestemmingslijst', () => {
    // Deze vier zijn geen gemak maar macht: `rm -rf <pad>` kan de spiegel van een andere
    // app wissen, en `git -C <pad> push` omzeilt de grens tussen voorstellen en landen.
    // Een latere uitbreiding mag die grens niet stil oprekken.
    const def = leesAgentFrontmatter(AGENT_BOUWER);
    expect(def.allowedTools.some((g) => g.startsWith('Bash(rm'))).toBe(false);
    expect(def.allowedTools.some((g) => g.startsWith('Bash(git -C'))).toBe(false);
    expect(def.allowedTools.some((g) => g.includes('push'))).toBe(false);
    expect(def.allowedTools.some((g) => g.includes('gh pr'))).toBe(false);
  });

  it('de bouwer mag schrijven en de refiner niet — de scheiding is intact', () => {
    const bouwer = leesAgentFrontmatter(AGENT_BOUWER);
    expect(bouwer.allowedTools).toContain('Write');
    expect(bouwer.disallowedTools).toContain('Bash(git push:*)');
  });
});

describe('draaiReviewer', () => {
  afterEach(() => {
    herstelAsyncUitvoerder();
  });

  function metEnvelop(naam: string, code = 0) {
    const opnemer = maakAsyncUitvoerderOpnemer(() => ({ code, stdout: envelop(naam) }));
    stelAsyncUitvoerderIn(opnemer.uitvoerder);
    return opnemer;
  }

  it('leest een review met twee bevindingen', async () => {
    metEnvelop('claude-review-klaar');

    const uitkomst = await draaiReviewer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.kosten).toBeCloseTo(1.23);
    expect(uitkomst.beurten).toBe(8);
    const verdict = uitkomst.verdict;
    expect(verdict?.bevindingen).toHaveLength(2);
    expect(verdict?.bevindingen[0]?.bestand).toBe('src/commands/promote.ts');
    expect(verdict?.bevindingen[0]?.regel).toBe(42);
    expect(verdict?.bevindingen[0]?.ernst).toBe('hoog');
    expect(verdict?.oordeel).toMatch(/grotendeels goed/);
  });

  it('accepteert nul bevindingen als geldige uitkomst', async () => {
    metEnvelop('claude-review-leeg');

    const uitkomst = await draaiReviewer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict?.bevindingen).toHaveLength(0);
    expect(uitkomst.verdict?.oordeel).toMatch(/Geen bijzonderheden/);
  });

  it('herkent is_error als mislukt, zonder het inleveren te blokkeren', async () => {
    metEnvelop('claude-review-fout');

    const uitkomst = await draaiReviewer(OPDRACHT);

    // Een gefaalde review is geen reden om de bouw te blokkeren (#184).
    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toMatch(/Budget overschreden/);
    expect(uitkomst.verdict).toBeUndefined();
  });

  it('roept claude aan met het review-schema en --agent reviewer', async () => {
    const { aanroepen } = metEnvelop('claude-review-klaar');

    await draaiReviewer({ ...OPDRACHT, agent: AGENT_REVIEWER });

    const args = aanroepen[0]?.argumenten ?? [];
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(REVIEW_JSON_SCHEMA));
    // De reviewer krijgt zijn eigen agent-definitie; die is lees-alleen — de grens
    // gaat expliciet mee zodat het subagent-formaat hem niet stil verruimt (#547).
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe(AGENT_REVIEWER);
    expect(args).toContain('--allowedTools');
    expect(args).toContain('--disallowedTools');
  });
});
