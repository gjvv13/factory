import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// De dispatch-lus in release.yml is shell, geen TypeScript, dus hij valt buiten de
// gewone tests. Wat hier bewaakt wordt is precies de fout die #244 opleverde: de lus
// gooide gh's stderr weg, dus een gefaalde dispatch meldde zich zonder reden.
describe('release.yml — de apps op de hoogte brengen', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  const lus = workflow.slice(
    workflow.indexOf('for app in assistant'),
    workflow.indexOf('dispatch_mislukt='),
  );

  it('bevat de dispatch-lus', () => {
    expect(lus).toContain('gh workflow run bump-factory.yml');
  });

  it('houdt gh’s stderr vast in plaats van hem weg te gooien', () => {
    expect(lus).not.toContain('>/dev/null 2>&1');
    expect(lus).toContain('2>&1 >/dev/null');
    expect(lus).toMatch(/kon \$app niet op de hoogte brengen van \$v: \$\{reden/);
  });

  it('waarschuwt ook als RELEASE_PAT helemaal niet gezet is', () => {
    const zonderToken = lus.slice(lus.indexOf('-z "$RELEASE_PAT"'), lus.indexOf('continue'));
    expect(zonderToken).toContain('::warning::');
  });
});
