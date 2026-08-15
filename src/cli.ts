#!/usr/bin/env node
import { backup } from './commands/backup.js';
import { deploy } from './commands/deploy.js';
import { env } from './commands/env.js';
import { flag } from './commands/flag.js';
import { inleveren } from './commands/inleveren.js';
import { integreer } from './commands/integreer.js';
import { nieuw } from './commands/nieuw.js';
import { promote } from './commands/promote.js';
import { release } from './commands/release.js';
import { sync } from './commands/sync.js';
import { verify } from './commands/verify.js';
import { toonMigratieStatus } from './migratie.js';
import { fout, GebruikersFout } from './shell.js';

const HULP = `factory — pipeline van idee tot productie

  factory verify [--snel|--pre-commit]   kwaliteitspoort: opmaak, lint, types, tests, build
  factory inleveren [--titel=<titel>]    poort draaien, branch pushen, PR openen en in de merge-queue/wachtrij zetten
  factory integreer [--repo=<owner/naam>|--installeer|--verwijder]  werk de wachtrij af (--repo: TCC-vrij van overal)
  factory release [patch|minor|major]    verify, versie verhogen, committen en taggen
  factory promote <acc|prod> [tag] [--ja] release-tag uitrollen en de omgeving herstarten
  factory deploy <acc|prod>              uitrol-orchestratie voor de runner (acc: release + promote)
  factory heeft-migratie                 print ja/nee: bevat deze release een nieuwe DB-migratie (voor de prod-poort)
  factory env <status|start|stop|reload|logs> [omgeving]
  factory flag <omgeving> [naam] [on|off]
  factory backup <acc|prod> [aantal] [--offsite=<dir>]  consistente SQLite-backup + rotatie (standaard 7 generaties)
  factory nieuw <naam> [--link]          nieuwe applicatie uit het skeleton
  factory sync [--check]                 slash commands en git hook gelijkzetten (--check: alleen signaleren)
`;

async function main(argumenten: string[]): Promise<void> {
  const [commando, ...rest] = argumenten;
  const vlaggen = new Set(rest.filter((argument) => argument.startsWith('--')));
  const positioneel = rest.filter((argument) => !argument.startsWith('--'));

  switch (commando) {
    case 'verify':
      verify({ snel: vlaggen.has('--snel'), preCommit: vlaggen.has('--pre-commit') });
      return;
    case 'inleveren': {
      const titel = [...vlaggen]
        .find((vlag) => vlag.startsWith('--titel='))
        ?.slice('--titel='.length);
      inleveren(titel === undefined || titel === '' ? {} : { titel });
      return;
    }
    case 'integreer': {
      const repo = [...vlaggen].find((vlag) => vlag.startsWith('--repo='))?.slice('--repo='.length);
      integreer({
        installeer: vlaggen.has('--installeer'),
        verwijder: vlaggen.has('--verwijder'),
        ...(repo === undefined || repo === '' ? {} : { repo }),
      });
      return;
    }
    case 'release':
      release(positioneel[0]);
      return;
    case 'promote':
      await promote(positioneel[0], positioneel[1], { ja: vlaggen.has('--ja') });
      return;
    case 'deploy':
      await deploy(positioneel[0]);
      return;
    case 'heeft-migratie':
      toonMigratieStatus();
      return;
    case 'env':
      await env(positioneel[0], positioneel[1]);
      return;
    case 'flag':
      await flag(positioneel[0], positioneel[1], positioneel[2]);
      return;
    case 'backup': {
      const offsite = [...vlaggen]
        .find((vlag) => vlag.startsWith('--offsite='))
        ?.slice('--offsite='.length);
      backup(positioneel[0], {
        ...(positioneel[1] === undefined ? {} : { bewaar: Number(positioneel[1]) }),
        ...(offsite === undefined || offsite === '' ? {} : { offsiteDir: offsite }),
      });
      return;
    }
    case 'nieuw':
      nieuw(positioneel[0], { link: vlaggen.has('--link') });
      return;
    case 'sync':
      sync({ check: vlaggen.has('--check') });
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HULP);
      return;
    default:
      throw new GebruikersFout(`Onbekend commando '${commando}'. Zie: factory help`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof GebruikersFout) {
    fout(error.message);
  } else {
    fout(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
