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
      // De geremedieerde node moet naar de volgende stappen propageren; anders draait de
      // install (en build/deploy) alsnog op de oude node en is de remediatie zinloos
      // omdat elke run:-stap in een verse shell start (#669-review).
      expect(mini).toContain('>> "$GITHUB_PATH"');
    });
  }

  it('bump-factory.yml wrapt pnpm install in een retry-loop (#668)', () => {
    const inhoud = readFileSync('workflows/bump-factory.yml', 'utf8');
    // Bounded retry: 3 pogingen met oplopende backoff, dezelfde bescherming als deploy.yml.
    expect(inhoud).toContain('::warning::');
    expect(inhoud).toContain('::error::pnpm install bleef falen na 3 pogingen');
    expect(inhoud).toContain('sleep');
  });

  it('deploy.yml detecteert lockfile-drift en remedieert met --no-frozen-lockfile (#669)', () => {
    const inhoud = readFileSync('workflows/deploy.yml', 'utf8');
    expect(inhoud).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
    expect(inhoud).toContain('ERR_PNPM_FROZEN_LOCKFILE');
    expect(inhoud).toContain('--no-frozen-lockfile');
  });

  it('de gefaalde-deploy-melding diagnosticeert faalklasse + actie (#670)', () => {
    const inhoud = readFileSync('workflows/deploy.yml', 'utf8');
    // Beide meldingsstappen (acc + prod) verrijken het bericht met oorzaak + actie.
    expect(inhoud.split('oorzaak: $oorzaak; actie: $actie').length - 1).toBe(2);
    // De diagnose leest de stap-uitkomsten als env-vars en valt terug op "onbekend"
    // als geen stap als gefaald te identificeren is (job viel vóór de eerste stap om).
    expect(inhoud).toContain('STAP_DEPLOY: ${{ steps.deploy.outcome }}');
    expect(inhoud).toContain('STAP_ROOKTEST: ${{ steps.rooktest.outcome }}');
    expect(inhoud).toContain('oorzaak="onbekend (geen stap geïdentificeerd)"');
    // Prod heeft een extra secrets-diagnose (die stap bestaat alleen daar).
    expect(inhoud).toContain('STAP_SECRETS: ${{ steps.secrets.outcome }}');
  });

  it('de install-stap schrijft stderr buiten de tree, niet in de repo-root (#719)', () => {
    // Een `install_stderr.txt` in de root laat de werkmap "vuil", en `factory release`
    // (in `deploy acc/prod`) weigert dan op de clean-check (regressie #669, #719).
    const inhoud = readFileSync('workflows/deploy.yml', 'utf8');
    expect(inhoud).toContain('"${RUNNER_TEMP:-/tmp}/install_stderr.txt"');
    // Geen kaal root-pad meer: `2>install_stderr.txt` mag nergens staan.
    expect(inhoud).not.toContain('2>install_stderr.txt');
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
