import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `workflows/bump-factory.yml` is shell en YAML, dus hij valt buiten de gewone tests.
// Wat hier bewaakt wordt is de blokkade van #245: de bump pushte met het ingebouwde
// GITHUB_TOKEN, en dat mag geen workflow-bestanden schrijven — terwijl `factory sync`
// die juist meebrengt. Alle vijf de apps kwamen daardoor niet meer aan een nieuwe
// factory-tag.
describe('bump-factory.yml — de bump kan pushen wat sync meebrengt', () => {
  const workflow = readFileSync('workflows/bump-factory.yml', 'utf8');

  it('checkt uit met een PAT die workflow-bestanden mag, met het ingebouwde token als terugval', () => {
    expect(workflow).toContain('token: ${{ secrets.PROJECT_TOKEN || github.token }}');
  });

  it('stopt met een uitleg als dat secret ontbreekt, in plaats van te stranden op de push', () => {
    const stap = workflow.slice(workflow.indexOf('nieuwste=$('), workflow.indexOf('git push'));
    expect(stap).toMatch(/-z "\$PUSH_TOKEN"/);
    expect(stap).toContain('::error::');
    // De poort staat ná de "niets te doen"-afslag: een run zonder bump blijft groen,
    // ook zonder token.
    expect(stap.indexOf('niets te doen')).toBeLessThan(stap.indexOf('-z "$PUSH_TOKEN"'));
  });

  it('dispatcht de deploy niet meer, want de push met een PAT triggert hem zelf', () => {
    expect(workflow).not.toContain('gh workflow run deploy.yml');
  });
});

// De bump is model-bewust (#695/#708): een git-dep bumpt naar de nieuwste git-tag, een
// registry-dep naar de nieuwste npm-versie. Een mislukte opzoeking (netwerkblip) mag in
// géén van beide takken als "niets te doen" wegvallen (#263) — dat verbergt de fout.
describe('bump-factory.yml — model-bewust, en een mislukte opzoeking is een fout (#263/#708)', () => {
  const workflow = readFileSync('workflows/bump-factory.yml', 'utf8');
  // De volledige bump-logica: van de model-detectie tot het begin van de echte bump.
  // Syntactisch compleet (het hele `if…else…fi`), zodat het als los script draaibaar is.
  const start = workflow.indexOf('if printf \'%s\' "$dep"');
  const einde = workflow.indexOf('::notice::factory bumpen');
  const logica = workflow.slice(start, einde);
  const snippet = logica
    .split('\n')
    .map((r) => r.replace(/^ {10}/, ''))
    .join('\n');

  it('detecteert het model aan de dep-vorm (git-tag vs registry-versie)', () => {
    expect(logica).toContain("if printf '%s' \"$dep\" | grep -q '#'");
    expect(logica).toContain('git ls-remote --tags');
    expect(logica).toContain('npm view @gjvv13/factory version');
  });

  it('maakt van een lege uitkomst een aparte fout, niet onderdeel van de vergelijking', () => {
    expect(logica).toMatch(/if \[ -z "\$nieuwste" \];\s*then/);
    expect(logica).toContain('::error::');
    // De oude gecombineerde check mag er niet meer staan.
    expect(logica).not.toContain('[ -z "$nieuwste" ] || [ "$huidig" = "$nieuwste" ]');
  });

  it('git-model: een onbereikbare remote is een fout, geen "niets te doen"', () => {
    const script = [
      'git() { echo "fatal: Could not resolve host: github.com" >&2; return 128; }',
      'dep="git+https://github.com/gjvv13/factory.git#v1.15.38"',
      snippet,
    ].join('\n');
    const { status, stdout, stderr } = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(status).toBe(1);
    expect(stdout + stderr).toContain('kon de factory-tags niet opvragen');
    expect(stdout + stderr).not.toContain('niets te doen');
  });

  it('registry-model: een onbereikbare registry is een fout, geen "niets te doen"', () => {
    const script = [
      'npm() { echo "npm error network" >&2; return 1; }',
      'dep="^1.15.38"',
      snippet,
    ].join('\n');
    const { status, stdout, stderr } = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(status).toBe(1);
    expect(stdout + stderr).toContain('kon de nieuwste @gjvv13/factory-versie niet opvragen');
    expect(stdout + stderr).not.toContain('niets te doen');
  });
});
