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
        status: 'completed',
        url: 'https://github.com/gjvv13/assistant/actions/runs/123',
      },
      {
        conclusion: 'failure',
        createdAt: '2026-09-04T04:00:00.000Z',
        status: 'completed',
        url: 'https://github.com/gjvv13/assistant/actions/runs/122',
      },
    ]);
    const leesRun = vi.fn().mockReturnValue(fixture);

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({
      app: 'assistant',
      conclusion: 'success',
      status: 'completed',
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
          status: 'completed',
          url: `https://github.com/gjvv13/${app}/actions/runs/1`,
        },
      ]),
    );

    const runs = haalDeployRuns(['assistant', 'beheer'], leesRun);

    expect(runs).toHaveLength(2);
    expect(runs[0]?.conclusion).toBe('success');
    expect(runs[1]?.conclusion).toBe('failure');
  });

  it('zet een lege conclusion om naar "unknown" in plaats van de lege string', () => {
    const fixture = JSON.stringify([
      {
        conclusion: '',
        createdAt: '2026-09-05T06:00:00.000Z',
        status: 'in_progress',
        url: 'https://github.com/gjvv13/assistant/actions/runs/789',
      },
    ]);
    const leesRun = vi.fn().mockReturnValue(fixture);

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.conclusion).toBe('unknown');
    expect(runs[0]?.status).toBe('in_progress');
  });

  it('leest het status-veld uit de respons', () => {
    const fixture = JSON.stringify([
      {
        conclusion: 'success',
        createdAt: '2026-09-05T04:00:00.000Z',
        status: 'completed',
        url: 'https://github.com/gjvv13/assistant/actions/runs/123',
      },
    ]);
    const leesRun = vi.fn().mockReturnValue(fixture);

    const runs = haalDeployRuns(['assistant'], leesRun);

    expect(runs[0]?.status).toBe('completed');
  });

  it('filtert proefapp uit de app-lijst', () => {
    const leesRun = vi.fn().mockReturnValue(
      JSON.stringify([
        {
          conclusion: 'success',
          createdAt: '2026-09-05T04:00:00.000Z',
          status: 'completed',
          url: 'https://github.com/gjvv13/proefapp/actions/runs/1',
        },
      ]),
    );

    const runs = haalDeployRuns(['assistant', 'proefapp'], leesRun);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.app).toBe('assistant');
    // proefapp wordt nooit aan leesRun doorgegeven
    expect(leesRun).not.toHaveBeenCalledWith('proefapp');
  });
});
