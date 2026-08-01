import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  leesOmgevingsWaarden,
  pm2NaamVan,
  vereisAppConfig,
  werkmapVan,
  type AppConfig,
  type Omgeving,
} from '../app-config.js';
import {
  bevestig,
  GebruikersFout,
  git,
  isInteractief,
  kop,
  ok,
  pakketbeheerder,
  run,
  uitvoerVan,
} from '../shell.js';

async function wachtOpGezond(url: string, seconden: number): Promise<string> {
  let laatsteFout = 'onbekend';
  for (let poging = 0; poging < seconden; poging += 1) {
    try {
      const antwoord = await fetch(url);
      if (antwoord.ok) {
        return await antwoord.text();
      }
      laatsteFout = `status ${String(antwoord.status)}`;
    } catch (error) {
      laatsteFout = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new GebruikersFout(`Werd niet gezond binnen ${String(seconden)}s: ${laatsteFout}`);
}

function omgevingsVariabelen(
  appDir: string,
  werkmap: string,
  omgeving: Omgeving,
): NodeJS.ProcessEnv {
  // De env-bestanden van de omgeving eroverheen, zodat migrate en seed op de
  // juiste database draaien (bijv. DATABASE_FILE=data/prod.sqlite) en niet op de
  // default. ROOT_DIR en FACTORY_ENV dwingen we daarna af, net als de ecosystem.
  return {
    ...process.env,
    ...leesOmgevingsWaarden(appDir, omgeving),
    ROOT_DIR: werkmap,
    FACTORY_ENV: omgeving,
  };
}

/**
 * Zet een release-tag neer op acc of prod en herstart die omgeving.
 * De omgevingen zijn losse clones die altijd op een tag staan, nooit op een
 * branch, zodat werk in de repo een draaiende omgeving niet raakt.
 */
export interface PromoteOpties {
  /** Slaat de bevestigingsvraag voor prod over; nodig om niet-interactief (CI) te promoveren. */
  readonly ja?: boolean;
}

export async function promote(
  omgevingArgument: string | undefined,
  tagArgument: string | undefined,
  opties: PromoteOpties = {},
): Promise<void> {
  if (omgevingArgument !== 'acc' && omgevingArgument !== 'prod') {
    throw new GebruikersFout('Gebruik: factory promote <acc|prod> [tag]');
  }
  const omgeving: Omgeving = omgevingArgument;

  // Prod vraagt bevestiging. Kan die niet gesteld worden (geen terminal) en is er
  // ook geen --ja, dan stoppen we meteen, vóór er iets aan de omgeving gebeurt.
  const vraagtBevestiging = omgeving === 'prod' && opties.ja !== true;
  if (vraagtBevestiging && !isInteractief()) {
    throw new GebruikersFout(
      'Prod omzetten vraagt bevestiging. Draai je dit niet-interactief (CI), geef dan --ja mee.',
    );
  }

  const config: AppConfig = vereisAppConfig();
  const repoDir = config.appDir;

  const tag =
    tagArgument ??
    uitvoerVan('git', ['tag', '--sort=-v:refname'], repoDir)?.split('\n')[0]?.trim() ??
    '';
  if (tag === '') {
    throw new GebruikersFout('Geen tag gevonden. Maak eerst een release met: factory release');
  }
  if (
    uitvoerVan('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], repoDir) === undefined
  ) {
    throw new GebruikersFout(`Tag '${tag}' bestaat niet.`);
  }

  const werkmap = werkmapVan(config, omgeving);
  const poort = config.poorten[omgeving];
  const pm2Naam = pm2NaamVan(config, omgeving);

  kop(`Promoveren van ${tag} naar ${omgeving} (${config.naam})`);

  if (!existsSync(path.join(werkmap, '.git'))) {
    // Bewust `git init` en geen `git clone`: de map kan al bestaan met een
    // database van een eerdere versie erin, en die mag een herdeploy niet blokkeren.
    kop(`Werkmap voor ${omgeving} inrichten in ${werkmap}`);
    mkdirSync(werkmap, { recursive: true });
    run('git', ['init', '-q', werkmap]);
  }

  kop('Tag uitchecken');
  const remotes = (uitvoerVan('git', ['remote'], werkmap) ?? '').split('\n').filter(Boolean);
  git(['remote', remotes.includes('origin') ? 'set-url' : 'add', 'origin', repoDir], werkmap);
  git(['fetch', '-q', '--tags', 'origin'], werkmap);
  git(['checkout', '-q', '--detach', tag], werkmap);
  git(['clean', '-qfd', '-e', 'data', '-e', 'logs', '-e', 'node_modules'], werkmap);
  ok(uitvoerVan('git', ['describe', '--tags'], werkmap) ?? tag);

  const { commando, basisArgumenten } = pakketbeheerder();

  kop('Afhankelijkheden installeren');
  run(commando, [...basisArgumenten, 'install', '--frozen-lockfile', '--prod=false'], {
    cwd: werkmap,
    capture: true,
  });

  kop('Bouwen');
  run(commando, [...basisArgumenten, 'run', 'build'], { cwd: werkmap, capture: true });

  kop('Database migreren');
  run(commando, [...basisArgumenten, 'run', 'migrate'], {
    cwd: werkmap,
    env: omgevingsVariabelen(repoDir, werkmap, omgeving),
  });

  if (omgeving === 'acc') {
    kop('Testdata inlezen op acceptatie');
    run(commando, [...basisArgumenten, 'run', 'seed'], {
      cwd: werkmap,
      env: omgevingsVariabelen(repoDir, werkmap, omgeving),
    });
  }

  if (vraagtBevestiging && !(await bevestig(`Prod omzetten naar ${tag}?`))) {
    throw new GebruikersFout('Afgebroken: prod is niet omgezet.');
  }

  kop('Omgeving herstarten');
  mkdirSync(path.join(repoDir, 'logs'), { recursive: true });
  const ecosystem = path.join(repoDir, 'environments', 'ecosystem.config.cjs');
  // Een bestaand proces verwijderen we eerst, en starten daarna vers uit de
  // ecosystem. Bewust geen `pm2 restart --update-env`: dat herleest de
  // ecosystem-env niet, maar neemt de env van deze CLI-aanroep over. Verandert
  // een waarde tussen twee deploys (bijv. CHANNEL van 'whatsapp' naar
  // 'whatsapp-cloud'), dan blijft het draaiende proces de oude waarde houden en
  // faalt de gezondheidscheck bij strengere config-validatie. Alleen een verse
  // start van ecosystem.config.cjs evalueert dat bestand opnieuw en leest zo de
  // gewijzigde environments/<omgeving>.env(.secrets) in.
  const bestaat = run('pm2', ['describe', pm2Naam], { capture: true, toleranter: true }).code === 0;
  if (bestaat) {
    run('pm2', ['delete', pm2Naam], { capture: true });
  }
  run('pm2', ['start', ecosystem, '--only', pm2Naam], { capture: true });
  run('pm2', ['save'], { capture: true, toleranter: true });

  kop(`Controleren of ${omgeving} leeft`);
  const antwoord = await wachtOpGezond(`http://127.0.0.1:${String(poort)}/health`, 30);
  ok(`${omgeving} is gezond: ${antwoord}`);
}
