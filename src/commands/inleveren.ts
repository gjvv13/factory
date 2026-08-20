import { existsSync } from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import { issueUitBranch, plaatsComment, zetKolom } from '../board.js';
import { BASISLIJN_BESTAND } from '../dekking-basislijn.js';
import {
  GebruikersFout,
  git,
  installeer,
  kop,
  ok,
  run,
  runMetHerhaling,
  uitvoerVan,
  waarschuwing,
} from '../shell.js';
import { heeftIntegreerAgent, WACHTRIJ_LABEL, zorgVoorWachtrijLabel } from './integreer.js';
import { verify } from './verify.js';
import { repoWortelVan, ruimWerkplekOp, werkplekVanSessie } from './werkplek.js';

export interface InleverenOpties {
  /** Titel voor de PR; zonder dit vult gh de titel uit de commits (`--fill`). */
  readonly titel?: string;
  /**
   * Levert in zonder auto-merge: de PR wordt geopend en blijft staan tot iemand hem
   * merget (#183). Voor een onbemande bouw-werker: die mag code voorstellen, niet
   * landen. Op een app met de lokale wachtrij betekent het dat het `wachtrij`-label
   * niet gezet wordt, want dat label ís de opdracht om te mergen.
   */
  readonly geenAutomerge?: boolean;
  /** De repo waarin ingeleverd wordt; de bouw-werker (#183) levert in vanuit een worktree. */
  readonly cwd?: string;
}

/** Committeert een gewijzigd bestand met een korte melding; slaat over als het niet wijzigde. */
function commitAlsGewijzigd(repoDir: string, bestand: string, melding: string): boolean {
  if (!existsSync(path.join(repoDir, bestand))) {
    return false;
  }
  if (uitvoerVan('git', ['status', '--porcelain', bestand], repoDir) === '') {
    return false;
  }
  git(['add', bestand], repoDir);
  git(['commit', '-q', '-m', melding], repoDir);
  return true;
}

/** De URL van de bestaande PR voor deze branch, of undefined als er nog geen is. */
function bestaandePr(repoDir: string, branch: string): string | undefined {
  const url = uitvoerVan('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], repoDir);
  return url === undefined || url === '' ? undefined : url;
}

/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export function inleveren(opties: InleverenOpties = {}): void {
  const repoDir = opties.cwd ?? process.cwd();

  const branch = uitvoerVan('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  if (branch === undefined || branch === 'main') {
    throw new GebruikersFout(
      `Inleveren doe je vanaf een slice-branch, niet vanaf '${branch ?? '?'}'.`,
    );
  }

  if (uitvoerVan('git', ['status', '--porcelain'], repoDir) !== '') {
    git(['status', '--short'], repoDir);
    throw new GebruikersFout('Werkmap is niet schoon. Commit je wijzigingen eerst.');
  }

  // Vóór de dure stappen: botst deze branch met de main van nu? Dan is rebasen
  // onvermijdelijk en moet verify daarna tóch opnieuw. Eerst een halfuur poort draaien
  // om dat daarna weg te gooien is precies de verspilling die we hier wegnemen.
  runMetHerhaling('git', ['fetch', '-q', 'origin', 'main'], { cwd: repoDir }, { wat: 'git fetch' });
  const botsing = conflictMetMain(repoDir);
  if (botsing !== undefined) {
    throw new GebruikersFout(
      `main is verder gelopen en botst met ${branch} (${botsing.join(', ')}).\n` +
        '  Rebase erop, los het één keer op, en lever daarna opnieuw in:\n' +
        '    git rebase origin/main\n' +
        '    # los de conflicten op, dan: git add <bestand> && git rebase --continue\n' +
        lockfileHint(botsing) +
        '    factory inleveren\n' +
        '  De kwaliteitspoort draait dan opnieuw, over het samengevoegde resultaat.',
    );
  }

  // Lockfile in lijn met package.json brengen zodat de merge-queue er niet op
  // struikelt (`--frozen-lockfile`). `--lockfile-only`: alleen de lockfile, geen
  // volledige install van node_modules.
  kop('Lockfile bijwerken');
  installeer(['--lockfile-only'], { cwd: repoDir, capture: true });
  ok(
    commitAlsGewijzigd(repoDir, 'pnpm-lock.yaml', 'sync lockfile voor inleveren')
      ? 'lockfile bijgewerkt en gecommit'
      : 'lockfile al in lijn',
  );

  kop('Kwaliteitspoort');
  verify();
  // De volledige verify kan de dekkings-basislijn hebben verhoogd; commit die mee,
  // zodat de branch schoon blijft en de verhoogde lat met de PR meereist.
  commitAlsGewijzigd(repoDir, BASISLIJN_BESTAND, 'verhoog dekking-basislijn');

  kop('Branch pushen');
  git(['push', '-q', '-u', 'origin', branch], repoDir);
  ok(`${branch} gepusht`);

  const appDir = zoekAppDir(repoDir);
  const config = appDir === undefined ? undefined : leesAppConfig(appDir);
  const lokaal = config?.integratie === 'lokaal';
  kop(lokaal ? 'PR openen en in de wachtrij zetten' : 'PR openen en in de merge-queue zetten');
  const titelArgumenten =
    opties.titel === undefined
      ? ['--fill']
      : ['--title', opties.titel, '--body', 'Ingeleverd via `factory inleveren`.'];
  const prUrl =
    bestaandePr(repoDir, branch) ??
    uitvoerVan(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', branch, ...titelArgumenten],
      repoDir,
    );
  if (prUrl === undefined || prUrl === '') {
    throw new GebruikersFout('Kon geen PR aanmaken of vinden met gh.');
  }

  // Het item schuift zelf mee (#128). Vanaf hier is de slice ingeleverd en dus onderweg
  // naar acc en prod; dat is precies wat de kolom Uitrollen betekent. Een branch zonder
  // slice-vorm hoort bij geen enkel backlog-item en verschuift daarom niets.
  const issue = issueUitBranch(branch);
  if (issue !== undefined && zetKolom(issue, 'Uitrollen', repoDir)) {
    plaatsComment(issue, `Ingeleverd via \`factory inleveren\`: ${prUrl}`, repoDir);
    ok(`#${String(issue)} staat op Uitrollen`);
  }

  // Nu opzoeken, zolang de map er nog is: het opruimen hieronder maakt hem onvindbaar.
  const werkplek = werkplekVanSessie(repoDir);

  if (opties.geenAutomerge === true) {
    // Een onbemande bouw-werker mag code voorstellen, niet landen. Dus geen auto-merge
    // en op een app ook geen `wachtrij`-label — dat label ís de opdracht om te mergen.
    // De PR staat er, de poort draait erop, en het mergen blijft een mensbesluit.
    ok(`PR geopend zonder auto-merge: ${prUrl}`);
    process.stdout.write(
      `\n${branch} wacht op een menselijke merge; er is niets in een wachtrij gezet.\n`,
    );
  } else if (lokaal) {
    // Factory-eigen wachtrij: label de PR. `factory integreer` op de mini werkt de rij
    // serieel af (voor private apps waar de GitHub merge-queue niet beschikbaar is).
    zorgVoorWachtrijLabel(repoDir);
    run('gh', ['pr', 'edit', prUrl, '--add-label', WACHTRIJ_LABEL], { cwd: repoDir });
    ok(`in de wachtrij gezet: ${prUrl}`);
    // Zonder een integreer-agent werkt niemand de rij af: de PR blijft stil staan
    // (de storing uit #108). Waarschuw expliciet en wijs de twee uitwegen aan.
    // `config` is hier non-undefined: `lokaal` kan alleen waar zijn als het gelezen is.
    if (heeftIntegreerAgent(config.naam)) {
      process.stdout.write(
        `\nDe factory-wachtrij integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`,
      );
    } else {
      const doel = ghDoelVanUrl(prUrl) ?? config.naam;
      waarschuwing(
        `geen integreer-agent voor ${config.naam} — deze PR blijft in de wachtrij staan.\n` +
          `  Installeer 'm met \`factory integreer --installeer\` (in de app-map),\n` +
          `  of werk de rij nu af met \`factory integreer --repo=${doel}\`.`,
      );
    }
  } else {
    // Auto-merge aanzetten: met een ingeschakelde merge-queue plaatst dit de PR in de
    // wachtrij zodra de checks groen zijn. De queue merget serieel naar main.
    run('gh', ['pr', 'merge', prUrl, '--auto', '--merge'], { cwd: repoDir });
    ok(`ingeleverd: ${prUrl}`);
    process.stdout.write(
      `\nDe merge-queue integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`,
    );
  }

  // Allerlaatste stap (#118): het werk zit in de PR, dus de werkmap heeft zijn dienst
  // gedaan. Blijft hij staan, dan stapelen de werkplekken zich op en weet niemand meer
  // welke nog leeft. Hierna bestaat `repoDir` niet meer, dus er mag niets meer volgen.
  if (werkplek !== undefined) {
    const wortel = repoWortelVan(repoDir);
    if (ruimWerkplekOp(wortel, werkplek)) {
      // Zeg het expliciet: de gebruiker staat nu in een map die er niet meer is, en
      // dat is verwarrend tot je het leest. Terugkomen kan altijd met `factory werkplek`.
      process.stdout.write(`Je stond in ${werkplek}; ga verder in ${wortel}.\n`);
    }
  }
}

/**
 * De bestanden waarop deze branch botst met `origin/main`, of undefined als het schoon
 * samengaat.
 *
 * `merge-tree --write-tree` doet de merge in het geheugen: geen checkout, geen
 * halfafgemaakte rebase in de werkmap. Het is een merge en geen rebase, dus strikt
 * genomen een benadering — maar botst de merge, dan botst de rebase ook, en dat is
 * precies wat we op tijd willen weten.
 */
function conflictMetMain(repoDir: string): string[] | undefined {
  const uitkomst = git(
    ['merge-tree', '--write-tree', '--name-only', 'origin/main', 'HEAD'],
    repoDir,
    {
      capture: true,
      toleranter: true,
    },
  );
  // Exitcode 1 betekent zowel "conflict" als "kon die refs niet mergen". Het verschil
  // zit in stdout: bij een conflict staat daar de tree-oid met de botsende bestanden,
  // bij een fout is stdout leeg en staat de reden op stderr. Zonder dit onderscheid
  // zou een repo zonder `origin/main` elk inleveren blokkeren met een verzonnen conflict.
  if (uitkomst.code === 0 || uitkomst.stdout.trim() === '') {
    return undefined;
  }
  // Eerste regel is de tree-oid, daarna de bestanden tot de lege regel voor de meldingen.
  // Ontbreekt die lege regel, dan lopen de bestanden tot het eind — `indexOf` geeft dan
  // -1, en `slice(0, -1)` zou stilletjes het láátste botsende bestand weglaten.
  const regels = uitkomst.stdout.split('\n').slice(1);
  const einde = regels.indexOf('');
  const bestanden = (einde === -1 ? regels : regels.slice(0, einde)).filter(
    (regel) => regel !== '',
  );
  return bestanden.length === 0 ? ['onbekend welk bestand'] : bestanden;
}

/**
 * Een extra regel voor de lockfile, want die mag je niet met de hand samenvoegen.
 *
 * `pnpm-lock.yaml` is het bestand dat het vaakst botst en het bestand waar handmatig
 * mergen het meeste kapotmaakt: het resultaat ziet er goed uit maar klopt niet meer met
 * `package.json`, en dan valt CI om op `--frozen-lockfile`. Regenereren is het antwoord.
 */
function lockfileHint(bestanden: string[]): string {
  return bestanden.includes('pnpm-lock.yaml')
    ? '    # pnpm-lock.yaml niet met de hand mergen maar opnieuw laten maken:\n' +
        '    #   git checkout --ours pnpm-lock.yaml && pnpm install --lockfile-only\n' +
        '    #   git add pnpm-lock.yaml && git rebase --continue\n'
    : '';
}

/** `<owner>/<naam>` uit een GitHub-PR-URL, voor de `--repo`-hint in de waarschuwing. */
function ghDoelVanUrl(prUrl: string): string | undefined {
  return /github\.com\/([^/]+\/[^/]+)\//.exec(prUrl)?.[1];
}
