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
