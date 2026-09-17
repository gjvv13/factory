import { spawnSync } from 'node:child_process';
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

  it('dispatcht direct bump-factory.yml, zonder dode factory-sync.yml-tak (#695/#696)', () => {
    // Alle apps draaien op registry-dep en gebruiken `bump-factory.yml` (model-bewust,
    // #708). De eerdere naam-tolerante dispatch (probeer factory-sync.yml eerst) was een
    // dode tak van de verlaten globale-CLI-aanpak (T9) en is verwijderd.
    expect(lus).not.toContain('factory-sync.yml');
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

// De factory wordt bij release naar de publieke npm-registry gepubliceerd, zodat
// consumenten haar als tarball installeren i.p.v. via een git-install (die crasht in
// npm op deze pnpm-repo, #707). Zie #714.
describe('release.yml — publiceren naar npm (#714)', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('publiceert publiek en is token-gated (waarschuwt-en-slaat-over zonder NPM_TOKEN)', () => {
    expect(workflow).toContain('npm publish --access public');
    expect(workflow).toContain('NPM_TOKEN: ${{ secrets.NPM_TOKEN }}');
    // Zonder token geen harde fout: de tag komt hoe dan ook vrij (zelfde patroon als
    // RELEASE_PAT/PROJECT_TOKEN).
    expect(workflow).toMatch(/if \[ -z "\$NPM_TOKEN" \]/);
    expect(workflow).toMatch(/::warning::NPM_TOKEN niet gezet/);
  });

  it('de globale-bin-job installeert uit de registry, niet meer via git-install', () => {
    const job = workflow.slice(workflow.indexOf('globale-bin:'));
    expect(job).toContain('npm install -g "@gjvv13/factory@$versie"');
    // De kapotte git-install (crashte in npm, faalde stil op EEXIST) is weg.
    expect(job).not.toContain('git+https://github.com/gjvv13/factory.git#$TAG');
  });

  it('de gepubliceerde tarball draagt dist (het `files`-veld) — anders is er geen CLI', () => {
    // Dit is de kern van waarom registry-install werkt waar git-install crasht: de
    // tarball bevat de gebouwde dist, dus de consument hoeft geen `prepare` te draaien.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      files?: string[];
      bin?: Record<string, string>;
    };
    expect(pkg.files).toContain('dist');
    expect(pkg.bin?.factory).toBe('./dist/cli.js');
  });
});

// Een lege taglijst hoort een fout te zijn, geen stille terugval op v0.0.0 (#263).
// De oude code deed `laatste="${laatste:-v0.0.0}"`, waardoor een lege git-fetch (of een
// verse repo) eruitzag als een geldige nulversie.
describe('release.yml — een lege taglijst is een fout, geen terugval (#263)', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  const bumpStap = workflow.slice(
    workflow.indexOf('Bump op een release-branch'),
    workflow.indexOf('melding:'),
  );

  it('valt niet meer stil terug op v0.0.0 bij een lege taglijst', () => {
    expect(bumpStap).not.toContain('${laatste:-v0.0.0}');
    expect(bumpStap).not.toContain('${laatste:-v0.0.0}');
  });

  it('maakt van een lege taglijst een expliciete fout', () => {
    // Na de `git tag --list`-opdracht moet een lege-check met een foutmelding staan.
    const tagOpzoek = bumpStap.slice(
      bumpStap.indexOf('git tag --list'),
      bumpStap.indexOf('nieuw="$(node'),
    );
    expect(tagOpzoek).toMatch(/if \[ -z "\$laatste" \]/);
    expect(tagOpzoek).toContain('::error::');
    expect(tagOpzoek).toContain('exit 1');
  });

  it('geeft een foutmelding bij een lege taglijst (bewijs met gemeten uitvoer)', () => {
    // Simuleer een repo zonder tags: `git tag --list` geeft niets terug.
    const script = [
      'git() {',
      '  case "$1" in',
      '    fetch) return 0 ;;',
      '    tag) ;; # geen uitvoer — lege taglijst',
      '  esac',
      '}',
      'laatste="$(git tag --list \'v*\' --sort=-v:refname | head -n1)"',
      'if [ -z "$laatste" ]; then',
      '  echo "::error::geen v*-tags gevonden"',
      '  exit 1',
      'fi',
      'echo "laatste=$laatste"',
    ].join('\n');

    const { status, stdout, stderr } = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toContain('::error::');
    expect(stdout + stderr).not.toContain('v0.0.0');
  });
});
