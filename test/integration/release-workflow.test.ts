import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// De apps worden bij een release niet meer expliciet gedispatcht: sinds #743 pikt
// Dependabot een nieuwe factory-versie zelf op (de dispatch-lus én `bump-factory.yml`
// zijn geretireerd). release.yml mag dus geen bump-factory meer aanroepen.
describe('release.yml — geen bump-factory-dispatch meer (#743)', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('dispatcht geen bump-factory meer', () => {
    expect(workflow).not.toContain('gh workflow run bump-factory.yml');
    expect(workflow).not.toContain('for app in assistant');
    expect(workflow).not.toContain('dispatch_mislukt');
  });

  it('noemt Dependabot als de nieuwe bump-bron', () => {
    expect(workflow).toContain('Dependabot');
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

// Na een release ruimt release.yml achterhaalde (superseded) release-PR's automatisch
// op, zodat een oudere `release/v<lager>`-PR niet als CONFLICTING blijft hangen (#671).
describe("release.yml — achterhaalde release-PR's opruimen (#671)", () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  // Isoleer de opruim-logica: van de eigen kop-comment tot de app-dispatch eronder.
  const stap = workflow.slice(
    workflow.indexOf('Achterhaalde release-PR'),
    workflow.indexOf('De apps pikken'),
  );

  it('haalt open release/v*-PR’s op en sluit ze met branch-opruiming', () => {
    expect(stap).toContain('gh pr list --repo gjvv13/factory --state open');
    expect(stap).toContain('startswith("release/v")');
    expect(stap).toContain('gh pr close');
    expect(stap).toContain('--delete-branch');
  });

  it('sluit alleen strikt lagere versies (numerieke vergelijking, exit 0 = lager)', () => {
    expect(stap).toContain('process.exit((a[i]||0)<(b[i]||0)?0:1)');
  });

  it('geeft de gesloten PR een comment met de achterhalende versie', () => {
    expect(stap).toContain('--comment "Achterhaald: $v is al getagd.');
  });

  it('is soft-fail: een opruimfout blokkeert de release niet', () => {
    expect(stap).toMatch(/\|\| echo "::warning::/);
  });

  it('draait met de ingebouwde GITHUB_TOKEN, niet met RELEASE_PAT', () => {
    // De step-env zet GH_TOKEN op github.token; de opruim-aanroepen zijn niet met
    // RELEASE_PAT geprefixt (zoals de app-dispatch en `gh pr create` dat wél zijn).
    expect(stap).not.toContain('GH_TOKEN="$RELEASE_PAT"');
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
