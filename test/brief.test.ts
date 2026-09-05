/**
 * Unit-tests voor `factory brief` (#404): het CLI-commando dat de bronnen
 * leest en de brief opbouwt. Test hier de I/O-laag: deploy-run-ophalen met
 * een fixture, en het fire-and-forget-patroon.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haalDeployRuns } from '../src/commands/brief.js';

describe('haalDeployRuns', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parset een geldige gh run list-respons en neemt de eerste run', () => {
    const fixture = JSON.stringify([
      {
        conclusion: 'success',
        createdAt: '2026-09-05T04:00:00.000Z',
        url: 'https://github.com/gjvv13/assistant/actions/runs/123',
      },
      {
        conclusion: 'failure',
        createdAt: '2026-09-04T04:00:00.000Z',
        url: 'https://github.com/gjvv13/assistant/actions/runs/122',
      },
    ]);
    const leesRun = vi.fn().mockReturnValue(fixture);

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({
      app: 'assistant',
      conclusion: 'success',
      url: 'https://github.com/gjvv13/assistant/actions/runs/123',
      createdAt: '2026-09-05T04:00:00.000Z',
    });
  });

  it('slaat een app over als gh run list undefined levert', () => {
    const leesRun = vi.fn().mockReturnValue(undefined);
    const runs = haalDeployRuns(['assistant'], leesRun);
    expect(runs).toEqual([]);
  });

  it('slaat een app over als gh run list een lege array levert', () => {
    const leesRun = vi.fn().mockReturnValue('[]');
    const runs = haalDeployRuns(['assistant'], leesRun);
    expect(runs).toEqual([]);
  });

  it('waarschuwt en slaat over bij ongeldige JSON', () => {
    const uitvoer: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    const leesRun = vi.fn().mockReturnValue('dit is geen json');

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs).toEqual([]);
    expect(uitvoer.join('')).toContain('kon niet worden geparsed');
  });

  it('haalt runs op voor meerdere apps', () => {
    const leesRun = vi.fn((app: string) =>
      JSON.stringify([
        {
          conclusion: app === 'assistant' ? 'success' : 'failure',
          createdAt: '2026-09-05T04:00:00.000Z',
          url: `https://github.com/gjvv13/${app}/actions/runs/1`,
        },
      ]),
    );

    const runs = haalDeployRuns(['assistant', 'beheer'], leesRun);

    expect(runs).toHaveLength(2);
    expect(runs[0]?.conclusion).toBe('success');
    expect(runs[1]?.conclusion).toBe('failure');
  });
});
