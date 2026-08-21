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

// Een mislukte opzoeking moet klinken als een fout, niet als "niets te doen" (#263).
// De oude code sloeg `git ls-remote`-mislukking en "al op de nieuwste versie" samen in
// één `[ -z "$nieuwste" ] || [ "$huidig" = "$nieuwste" ]`-tak, waardoor een netwerkblip
// een groen vinkje met "niets te doen" opleverde.
describe('bump-factory.yml — een mislukte opzoeking is een fout, geen "niets te doen" (#263)', () => {
  const workflow = readFileSync('workflows/bump-factory.yml', 'utf8');

  // De opzoeklogica: van de `git ls-remote`-aanroep tot het begin van de bump.
  const opzoekBegin = workflow.indexOf('if ! tags=$(');
  const opzoekEinde = workflow.indexOf('::notice::factory bumpen');
  const opzoekLogica = workflow.slice(opzoekBegin, opzoekEinde);

  it('vangt het exit-code van git ls-remote op in plaats van het te negeren', () => {
    // `if ! tags=$(git ls-remote ...)` vangt zowel de uitvoer als de exitcode op.
    expect(opzoekLogica).toMatch(/if ! tags=\$\(git ls-remote/);
    expect(opzoekLogica).toContain('2>&1');
  });

  it('maakt van een lege uitkomst een aparte fout, niet onderdeel van de tag-vergelijking', () => {
    // De lege-check en de gelijke-check staan in gescheiden `if`-blokken.
    expect(opzoekLogica).toMatch(/if \[ -z "\$nieuwste" \];\s*then/);
    expect(opzoekLogica).toContain('::error::');
    // De oude gecombineerde check mag er niet meer staan.
    expect(opzoekLogica).not.toContain('[ -z "$nieuwste" ] || [ "$huidig" = "$nieuwste" ]');
  });

  it('"niets te doen" volgt alleen uit een gelijke tag, niet uit een lege uitkomst', () => {
    // De "niets te doen"-tak bevat alleen de gelijke-tag-vergelijking, geen lege-check.
    const nietsTeDoen = opzoekLogica.slice(
      opzoekLogica.indexOf('niets te doen') - 120,
      opzoekLogica.indexOf('niets te doen') + 30,
    );
    expect(nietsTeDoen).toContain('$huidig" = "$nieuwste"');
    expect(nietsTeDoen).not.toContain('-z');
  });

  it('geeft een foutmelding bij een onbereikbare remote (bewijs met gemeten uitvoer)', () => {
    // De opzoeklogica uit de workflow, gedraaid met een nep-git die faalt — dezelfde
    // situatie als de DNS-blips op de mini (#263, #99).
    const snippet = opzoekLogica
      .split('\n')
      .map((r) => r.replace(/^ {10}/, ''))
      .join('\n');

    const script = [
      // Overschaduw git met een functie die een netwerkfout simuleert.
      'git() { echo "fatal: Could not resolve host: github.com" >&2; return 128; }',
      'huidig="v1.15.38"',
      snippet,
    ].join('\n');

    const { status, stdout, stderr } = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toContain('::error::');
    expect(stdout + stderr).toContain('kon de factory-tags niet opvragen');
    expect(stdout + stderr).not.toContain('niets te doen');
  });
});
