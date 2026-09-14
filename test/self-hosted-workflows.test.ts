import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * De jobs die op de mini draaien hebben `actions/setup-node` en `pnpm/action-setup`
 * niet nodig: node staat er (de runner-`.env` zet `NVM_BIN`) en pnpm komt uit
 * `corepack`. Toch werden ze élke job opnieuw van codeload gehaald, en daar liepen de
 * runs op stuk — 15 van 948 in de week tot 2026-08-21, allemaal in `Set up job` waar
 * geen retry mogelijk is (#270, restpunt van #99).
 *
 * Op `ubuntu-latest` blijven ze wél staan: daar is niets voorgeïnstalleerd, en die
 * downloads komen uit GitHub's eigen netwerk.
 */
describe('workflows op de mini halen geen node- of pnpm-action op', () => {
  /** De regels van elke job die op de mini draait. */
  function miniJobs(bestand: string): string {
    const inhoud = readFileSync(bestand, 'utf8');
    const jobs = inhoud.split(/\n {2}(?=[a-z0-9-]+:\n)/);
    return jobs.filter((job) => job.includes('[self-hosted, mini]')).join('\n');
  }

  for (const bestand of ['workflows/bump-factory.yml', 'workflows/deploy.yml']) {
    it(`${bestand} gebruikt node en pnpm van de runner`, () => {
      const mini = miniJobs(bestand);
      expect(mini).not.toContain('uses: actions/setup-node');
      expect(mini).not.toContain('uses: pnpm/action-setup');
      expect(mini).toContain('corepack enable pnpm');
    });

    it(`${bestand} remedieert node-drift met nvm install (#669)`, () => {
      const mini = miniJobs(bestand);
      // Bij een mismatch wordt nvm gesourced en de gevraagde node geïnstalleerd.
      expect(mini).toContain('nvm install');
      // Een mislukte nvm install is alsnog een harde fout.
      expect(mini).toContain('exit 1');
    });
  }

  it('deploy.yml detecteert lockfile-drift en remedieert met --no-frozen-lockfile (#669)', () => {
    const inhoud = readFileSync('workflows/deploy.yml', 'utf8');
    expect(inhoud).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
    expect(inhoud).toContain('ERR_PNPM_FROZEN_LOCKFILE');
    expect(inhoud).toContain('--no-frozen-lockfile');
  });

  it('de rerun-waakhond bewaakt ook de bump, niet alleen de deploy (#270)', () => {
    // Alle vijftien de action-download-mislukkingen van de week tot 2026-08-21 zaten in
    // `bump-factory`, en juist die had geen vangnet — de deploy had het al sinds #122.
    const inhoud = readFileSync('workflows/deploy-rerun.yml', 'utf8');
    expect(inhoud).toContain('workflows: [deploy, bump-factory]');
  });

  it('ci.yml houdt de actions, want die draait op ubuntu-latest', () => {
    const inhoud = readFileSync('workflows/ci.yml', 'utf8');
    expect(inhoud).toContain('ubuntu-latest');
    expect(inhoud).toContain('uses: actions/setup-node');
  });
});
