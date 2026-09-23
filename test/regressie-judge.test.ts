import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bouwJudgePrompt,
  draaiJudge,
  judgeArgumenten,
  parseJudgeRespons,
} from '../src/eval/judge.js';
import { normaliseerScore } from '../src/eval/rubriek.js';
import {
  GebruikersFout,
  herstelAsyncUitvoerder,
  herstelUitvoerder,
  stelAsyncUitvoerderIn,
  stelUitvoerderIn,
} from '../src/shell.js';
import { maakAsyncUitvoerderOpnemer } from './helpers.js';

function fixture(naam: string): unknown {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path.join(hier, 'fixtures', 'regressie', naam), 'utf8'));
}

describe('de judge-respons-parser', () => {
  it('leest de scores uit een geldige respons in rubriek-volgorde', () => {
    const { scores, toelichtingen } = parseJudgeRespons(fixture('judge-respons.json'));
    expect(scores).toEqual([2, 2, 1, 2, 2, 2, 1]);
    expect(toelichtingen).toHaveLength(7);
    expect(normaliseerScore(scores)).toBe(8.6);
  });

  it('weigert een respons die het schema niet haalt', () => {
    expect(() => parseJudgeRespons({ criteria: 'nee' })).toThrow(GebruikersFout);
  });

  it('weigert een respons met een ontbrekend criterium', () => {
    const respons = { criteria: [{ nummer: 1, score: 2, toelichting: 'x' }] };
    expect(() => parseJudgeRespons(respons)).toThrow(/mist criterium/);
  });

  it('weigert een respons met een dubbel criteriumnummer', () => {
    const dubbel = {
      criteria: [
        ...Array.from({ length: 7 }, (_, i) => ({
          nummer: i + 1,
          score: 1,
          toelichting: 'x',
        })),
        { nummer: 3, score: 2, toelichting: 'dubbel' },
      ],
    };
    expect(() => parseJudgeRespons(dubbel)).toThrow(/dubbel/);
  });

  it('weigert een score buiten 0–2', () => {
    const teHoog = {
      criteria: Array.from({ length: 7 }, (_, i) => ({
        nummer: i + 1,
        score: i === 0 ? 3 : 1,
        toelichting: 'x',
      })),
    };
    expect(() => parseJudgeRespons(teHoog)).toThrow(GebruikersFout);
  });
});

describe('de judge-prompt', () => {
  it('vult de rubriek, de issue-body en de werker-output in', () => {
    const prompt = bouwJudgePrompt('DE-ISSUE-BODY', 'DE-WERKER-OUTPUT');
    expect(prompt).toContain('DE-ISSUE-BODY');
    expect(prompt).toContain('DE-WERKER-OUTPUT');
    expect(prompt).toContain('Templatestructuur');
    expect(prompt).not.toContain('{{RUBRIEK}}');
    expect(prompt).not.toContain('{{ISSUE_BODY}}');
  });

  it('geeft het vastgepinde model en de effort door aan claude', () => {
    const args = judgeArgumenten({
      issueBody: 'b',
      werkerOutput: 'o',
      model: 'claude-sonnet-4-20250514',
      effort: 'medium',
      budgetUsd: 1,
    });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-20250514');
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
    expect(args).toContain('--json-schema');
  });
});

describe('de echte judge-run', () => {
  afterEach(() => {
    herstelUitvoerder();
    herstelAsyncUitvoerder();
  });

  it('parseert de structured_output uit de claude-envelop tot scores', async () => {
    const envelop = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'x',
      total_cost_usd: 0.03,
      structured_output: fixture('judge-respons.json'),
    };
    const opnemer = maakAsyncUitvoerderOpnemer(() => ({ stdout: JSON.stringify(envelop) }));
    stelAsyncUitvoerderIn(opnemer.uitvoerder);

    const uitslag = await draaiJudge({
      issueBody: 'b',
      werkerOutput: 'o',
      model: 'm',
      effort: 'medium',
      budgetUsd: 1,
    });
    expect(uitslag.scores).toEqual([2, 2, 1, 2, 2, 2, 1]);
    expect(uitslag.kosten).toBe(0.03);
    expect(opnemer.aanroepen[0]?.commando).toBe('claude');
  });

  it('faalt luid als de judge-run met een fout eindigt', async () => {
    const envelop = { type: 'result', subtype: 'error', is_error: true, session_id: 'x' };
    stelUitvoerderIn(() => ({ code: 0, stdout: JSON.stringify(envelop) }));
    await expect(
      draaiJudge({ issueBody: 'b', werkerOutput: 'o', model: 'm', effort: 'medium', budgetUsd: 1 }),
    ).rejects.toThrow(GebruikersFout);
  });

  it('faalt luid zonder gestructureerd oordeel', async () => {
    const envelop = { type: 'result', subtype: 'success', is_error: false, session_id: 'x' };
    stelUitvoerderIn(() => ({ code: 0, stdout: JSON.stringify(envelop) }));
    await expect(
      draaiJudge({ issueBody: 'b', werkerOutput: 'o', model: 'm', effort: 'medium', budgetUsd: 1 }),
    ).rejects.toThrow(/geen gestructureerd oordeel/);
  });

  it('faalt luid als de judge-run wordt afgekapt', async () => {
    stelAsyncUitvoerderIn(() => Promise.resolve({ code: 124, stdout: '', afgekapt: true }));
    await expect(
      draaiJudge({ issueBody: 'b', werkerOutput: 'o', model: 'm', effort: 'medium', budgetUsd: 1 }),
    ).rejects.toThrow(/afgekapt/);
  });

  it('faalt luid als claude geen leesbare JSON teruggeeft', async () => {
    stelUitvoerderIn(() => ({ code: 0, stdout: 'dit is geen json' }));
    await expect(
      draaiJudge({ issueBody: 'b', werkerOutput: 'o', model: 'm', effort: 'medium', budgetUsd: 1 }),
    ).rejects.toThrow(/geen leesbare JSON/);
  });

  it('faalt luid als de envelop van claude afwijkt', async () => {
    // Geldige JSON, maar zonder het verplichte is_error-veld.
    stelUitvoerderIn(() => ({ code: 0, stdout: JSON.stringify({ type: 'result' }) }));
    await expect(
      draaiJudge({ issueBody: 'b', werkerOutput: 'o', model: 'm', effort: 'medium', budgetUsd: 1 }),
    ).rejects.toThrow(/envelop/);
  });
});
