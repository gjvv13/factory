import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { herstelAsyncUitvoerder, stelAsyncUitvoerderIn } from '../src/shell.js';
import { AGENT_ACCEPTEERDER, draaiAccepteerder } from '../src/werker.js';
import { maakAsyncUitvoerderOpnemer, type ProcesAanroep } from './helpers.js';
import { leesAgentFrontmatter } from './agent-definitie.js';

const hier = path.dirname(fileURLToPath(import.meta.url));

/** Leest een claude-fixture als string. */
function fixture(naam: string): string {
  return readFileSync(path.join(hier, 'fixtures', naam), 'utf8');
}

/** Geeft de opgenomen envelop als stdout terug wanneer `claude` aangeroepen wordt. */
function metFixture(naam: string) {
  return maakAsyncUitvoerderOpnemer(({ commando }: ProcesAanroep) => {
    if (commando === 'claude') {
      return { stdout: fixture(naam) };
    }
    return {};
  });
}

afterEach(() => {
  herstelAsyncUitvoerder();
});

describe('accepteer-werker contracttest: groene run', () => {
  it('parseert een alles-waargenomen envelop naar een klaar-verdict', async () => {
    const { uitvoerder } = metFixture('claude-accepteer-groen.json');
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiAccepteerder({
      prompt: 'test',
      werkmap: '/tmp/test',
      sessie: 'test-sessie',
      budgetUsd: 3,
      agent: AGENT_ACCEPTEERDER,
    });

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict).toBeDefined();
    expect(uitkomst.verdict?.uitkomst).toBe('klaar');
    if (uitkomst.verdict?.uitkomst === 'klaar') {
      expect(uitkomst.verdict.criteria).toHaveLength(2);
      expect(uitkomst.verdict.criteria[0]?.status).toBe('waargenomen');
      expect(uitkomst.verdict.criteria[0]?.bewijs).toBeDefined();
    }
  });

  it('bevat kosten en beurten uit de envelop', async () => {
    const { uitvoerder } = metFixture('claude-accepteer-groen.json');
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiAccepteerder({
      prompt: 'test',
      werkmap: '/tmp/test',
      sessie: 'test-sessie',
      budgetUsd: 3,
      agent: AGENT_ACCEPTEERDER,
    });

    expect(uitkomst.kosten).toBe(1.23);
    expect(uitkomst.beurten).toBe(8);
  });
});

describe('accepteer-werker contracttest: is_error-variant', () => {
  it('herkent is_error: true als mislukt en geeft geen verdict', async () => {
    const { uitvoerder } = metFixture('claude-accepteer-fout.json');
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiAccepteerder({
      prompt: 'test',
      werkmap: '/tmp/test',
      sessie: 'test-sessie',
      budgetUsd: 3,
      agent: AGENT_ACCEPTEERDER,
    });

    // De val uit #153: is_error: true bij exit 0 is een mislukking, geen succes.
    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.verdict).toBeUndefined();
    expect(uitkomst.fout).toBeDefined();
  });
});

describe('accepteer-werker contracttest: waargenomen zonder bewijs', () => {
  it('weigert een waargenomen criterium zonder bewijs', async () => {
    // Een envelop met een criterium dat waargenomen is maar geen bewijs heeft.
    const envelop = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'test-sessie',
      num_turns: 5,
      total_cost_usd: 0.8,
      permission_denials: [],
      result: 'zie verdict',
      structured_output: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Het health-endpoint geeft status ok terug',
            status: 'waargenomen',
            // Geen bewijs — dit moet geweigerd worden door het schema.
          },
        ],
      },
    };

    const { uitvoerder } = maakAsyncUitvoerderOpnemer(({ commando }: ProcesAanroep) => {
      if (commando === 'claude') {
        return { stdout: JSON.stringify(envelop) };
      }
      return {};
    });
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiAccepteerder({
      prompt: 'test',
      werkmap: '/tmp/test',
      sessie: 'test-sessie',
      budgetUsd: 3,
      agent: AGENT_ACCEPTEERDER,
    });

    // Een waargenomen zonder bewijs is geen klaar, maar een mislukking.
    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.verdict).toBeUndefined();
    expect(uitkomst.fout).toMatch(/bewijs/i);
  });
});

describe('accepteer-werker contracttest: gemengde uitkomst met escalatie-criteria', () => {
  it('parseert een envelop met niet-waarneembaar en gefaald criteria', async () => {
    const { uitvoerder } = metFixture('claude-accepteer-escalatie.json');
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiAccepteerder({
      prompt: 'test',
      werkmap: '/tmp/test',
      sessie: 'test-sessie',
      budgetUsd: 3,
      agent: AGENT_ACCEPTEERDER,
    });

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict).toBeDefined();
    expect(uitkomst.verdict?.uitkomst).toBe('klaar');
    if (uitkomst.verdict?.uitkomst === 'klaar') {
      expect(uitkomst.verdict.criteria).toHaveLength(3);

      // Waargenomen criterium met bewijs.
      expect(uitkomst.verdict.criteria[0]?.status).toBe('waargenomen');
      expect(uitkomst.verdict.criteria[0]?.bewijs).toBeDefined();

      // Niet-waarneembaar criterium zonder bewijs.
      expect(uitkomst.verdict.criteria[1]?.status).toBe('niet-waarneembaar');
      expect(uitkomst.verdict.criteria[1]?.bewijs).toBeUndefined();

      // Gefaald criterium met bewijs (de aanroep en het afwijkende antwoord).
      expect(uitkomst.verdict.criteria[2]?.status).toBe('gefaald');
      expect(uitkomst.verdict.criteria[2]?.bewijs).toBeDefined();
      expect(uitkomst.verdict.criteria[2]?.bewijs?.antwoord).toContain('500');
    }
  });
});

describe('accepteer-werker permissions', () => {
  it('bevat geen schrijf-gereedschappen in de toestemmingslijst', () => {
    const def = leesAgentFrontmatter(AGENT_ACCEPTEERDER);
    const schrijfGereedschappen = ['Write', 'Edit', 'NotebookEdit'];
    for (const gereedschap of schrijfGereedschappen) {
      expect(def.allowedTools).not.toContain(gereedschap);
    }
  });

  it('bevat curl voor HTTP-aanroepen naar acc', () => {
    const def = leesAgentFrontmatter(AGENT_ACCEPTEERDER);
    expect(def.allowedTools).toContain('Bash(curl:*)');
  });

  it('verbiedt dezelfde dingen als de refine-werker', () => {
    const def = leesAgentFrontmatter(AGENT_ACCEPTEERDER);
    expect(def.disallowedTools).toContain('Write');
    expect(def.disallowedTools).toContain('Edit');
  });
});
