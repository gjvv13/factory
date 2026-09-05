/**
 * Contract-test voor de `gh run list`-respons die `factory brief` gebruikt (#404).
 *
 * De fixture is een opgenomen `gh run list --json conclusion,createdAt,url`-respons.
 * Deze test controleert dat `haalDeployRuns` het formaat correct parset — zodat een
 * wijziging in het `gh`-uitvoerformaat hier rood wordt, niet stilletjes in de brief.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { haalDeployRuns } from '../../src/commands/brief.js';

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'contract',
);

/** Schema dat vastlegt wat we van `gh run list --json conclusion,createdAt,url` verwachten. */
const ghRunListSchema = z.array(
  z.object({
    conclusion: z.string(),
    createdAt: z.string(),
    url: z.url(),
  }),
);

describe('contract: gh run list-respons voor de regie-brief', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('de fixture past bij het verwachte schema', () => {
    const fixture = readFileSync(path.join(fixtureDir, 'brief-deploy-runs.json'), 'utf8');
    const parsed = ghRunListSchema.safeParse(JSON.parse(fixture));
    expect(parsed.success).toBe(true);
  });

  it('haalDeployRuns parset de fixture correct', () => {
    const fixture = readFileSync(path.join(fixtureDir, 'brief-deploy-runs.json'), 'utf8');
    const leesRun = vi.fn().mockReturnValue(fixture);

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      app: 'assistant',
      conclusion: 'success',
      url: expect.stringContaining('github.com'),
      createdAt: expect.any(String),
    });
  });
});
