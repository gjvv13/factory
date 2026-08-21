#!/usr/bin/env node
import { afronden } from './commands/afronden.js';
import { backup } from './commands/backup.js';
import { board } from './commands/board.js';
import { deploy } from './commands/deploy.js';
import { env } from './commands/env.js';
import { flag } from './commands/flag.js';
import { inleveren } from './commands/inleveren.js';
import { integreer } from './commands/integreer.js';
import { nieuw } from './commands/nieuw.js';
import { opruimen } from './commands/opruimen.js';
import { orkestreer, orkestreerAntwoord, orkestreerStatus } from './commands/orkestreer.js';
import { leesIssue, leesReeks, leesSoort, orkestreerBouw } from './commands/orkestreer-bouw.js';
import { promote } from './commands/promote.js';
import { release } from './commands/release.js';
import { rooktest } from './commands/rooktest.js';
import { sync } from './commands/sync.js';
import { werkplek } from './commands/werkplek.js';
import { terugrol } from './commands/terugrol.js';
import { verify } from './commands/verify.js';
import { toonMigratieStatus } from './migratie.js';
import { leesArgumenten } from './argumenten.js';
import { fout, GebruikersFout } from './shell.js';
const HULP = `factory — pipeline van idee tot productie

  factory verify [--snel|--pre-commit]   kwaliteitspoort: opmaak, lint, types, tests, build
  factory inleveren [--titel=<titel>] [--geen-automerge]  poort draaien, branch pushen, PR openen en in de merge-queue/wachtrij zetten
  factory integreer [--repo=<owner/naam>|--installeer|--verwijder]  werk de wachtrij af (--repo: TCC-vrij van overal)
  factory release [patch|minor|major]    verify, versie verhogen, committen en taggen
  factory promote <acc|prod> [tag] [--ja] release-tag uitrollen en de omgeving herstarten
  factory deploy <acc|prod>              uitrol-orchestratie voor de runner (acc: release + promote)
  factory rooktest <acc|prod>            één read-only aanroep door de kern na een uitrol (uit factory.json)
  factory terugrol <acc|prod> [--ja]     promote de vorige tag terug naar de omgeving
  factory heeft-migratie                 print ja/nee: bevat deze release een nieuwe DB-migratie (voor de prod-poort)
  factory env <status|start|stop|reload|logs> [omgeving]
  factory flag <omgeving> [naam] [on|off]
  factory backup <acc|prod> [aantal] [--offsite=<dir>]  consistente SQLite-backup + rotatie (standaard 7 generaties)
  factory nieuw <naam> [--link]          nieuwe applicatie uit het skeleton
  factory sync [--check]                 slash commands en git hook gelijkzetten (--check: alleen signaleren)
  factory werkplek <issue> [--op]        eigen worktree voor een slice, naast de repo (--op: opruimen)
  factory orkestreer <--dry|--eenmalig|--reeks <n|lijst>|--nacht>  onbemande werker op de wachtrij 'Klaar voor technische refinement'
  factory orkestreer <--installeer|--verwijder>  de LaunchAgent die --nacht elke nacht draait
  factory orkestreer --soort bouw <--dry|--eenmalig|--reeks <n|lijst>>  bouw-werker: wachtrij tonen, één item, of een reeks (--reeks 4 of --reeks 126,186)
  factory orkestreer --issue <n>         deze run op dat item richten i.p.v. op de kop van de rij
  factory orkestreer status              wat wacht op jouw akkoord, wat is geëscaleerd, wat staat in de rij
  factory orkestreer antwoord <issue> "<tekst>" [--opnieuw]  een escalatie beantwoorden; hervat de sessie
  factory opruimen [--dry]               gemergede branches opruimen: lokaal en op de remote
  factory board <issue> "<kolom>"        één backlog-item van kolom veranderen (goedkoop: geen volledige boardlezing)
  factory afronden <vorigeTag> <tag>     factory-eigen items uit het tagbereik op Done (release-stap, #185)
`;
async function main(argumenten) {
    const [commando, ...rest] = argumenten;
    switch (commando) {
        case 'verify': {
            const { schakelaars } = leesArgumenten(rest, { schakelaars: ['--snel', '--pre-commit'] });
            verify({ snel: schakelaars.has('--snel'), preCommit: schakelaars.has('--pre-commit') });
            return;
        }
        case 'inleveren': {
            const { schakelaars, waarden } = leesArgumenten(rest, {
                schakelaars: ['--geen-automerge'],
                waarden: ['--titel'],
            });
            const titel = waarden.get('--titel');
            inleveren({
                ...(titel === undefined ? {} : { titel }),
                geenAutomerge: schakelaars.has('--geen-automerge'),
            });
            return;
        }
        case 'integreer': {
            const { schakelaars, waarden } = leesArgumenten(rest, {
                schakelaars: ['--installeer', '--verwijder'],
                waarden: ['--repo'],
            });
            const repo = waarden.get('--repo');
            integreer({
                installeer: schakelaars.has('--installeer'),
                verwijder: schakelaars.has('--verwijder'),
                ...(repo === undefined ? {} : { repo }),
            });
            return;
        }
        case 'release': {
            const { positioneel } = leesArgumenten(rest);
            release(positioneel[0]);
            return;
        }
        case 'promote': {
            const { schakelaars, positioneel } = leesArgumenten(rest, { schakelaars: ['--ja'] });
            await promote(positioneel[0], positioneel[1], { ja: schakelaars.has('--ja') });
            return;
        }
        case 'deploy': {
            const { positioneel } = leesArgumenten(rest);
            await deploy(positioneel[0]);
            return;
        }
        case 'rooktest': {
            const { positioneel } = leesArgumenten(rest);
            await rooktest(positioneel[0]);
            return;
        }
        case 'terugrol': {
            const { schakelaars, positioneel } = leesArgumenten(rest, { schakelaars: ['--ja'] });
            await terugrol(positioneel[0], { ja: schakelaars.has('--ja') });
            return;
        }
        case 'heeft-migratie':
            toonMigratieStatus();
            return;
        case 'env': {
            const { positioneel } = leesArgumenten(rest);
            await env(positioneel[0], positioneel[1]);
            return;
        }
        case 'flag': {
            const { positioneel } = leesArgumenten(rest);
            await flag(positioneel[0], positioneel[1], positioneel[2]);
            return;
        }
        case 'backup': {
            const { waarden, positioneel } = leesArgumenten(rest, { waarden: ['--offsite'] });
            const offsite = waarden.get('--offsite');
            backup(positioneel[0], {
                ...(positioneel[1] === undefined ? {} : { bewaar: Number(positioneel[1]) }),
                ...(offsite === undefined ? {} : { offsiteDir: offsite }),
            });
            return;
        }
        case 'nieuw': {
            const { schakelaars, positioneel } = leesArgumenten(rest, { schakelaars: ['--link'] });
            nieuw(positioneel[0], { link: schakelaars.has('--link') });
            return;
        }
        case 'werkplek': {
            const { schakelaars, positioneel } = leesArgumenten(rest, { schakelaars: ['--op'] });
            werkplek(positioneel[0], { op: schakelaars.has('--op') });
            return;
        }
        case 'orkestreer': {
            const { schakelaars, positioneel, waarden } = leesArgumenten(rest, {
                schakelaars: ['--dry', '--eenmalig', '--nacht', '--installeer', '--verwijder', '--opnieuw'],
                waarden: ['--soort', '--issue', '--reeks'],
            });
            const issue = leesIssue(waarden.get('--issue'));
            const reeks = leesReeks(waarden.get('--reeks'));
            if (leesSoort(waarden.get('--soort')) === 'bouw') {
                orkestreerBouw({
                    dry: schakelaars.has('--dry'),
                    eenmalig: schakelaars.has('--eenmalig'),
                    ...(issue === undefined ? {} : { issue }),
                    ...(reeks === undefined ? {} : { reeks }),
                });
                return;
            }
            if (positioneel[0] === 'status') {
                orkestreerStatus(process.cwd());
                return;
            }
            if (positioneel[0] === 'antwoord') {
                orkestreerAntwoord(positioneel[1], positioneel[2], {
                    opnieuw: schakelaars.has('--opnieuw'),
                });
                return;
            }
            if (positioneel[0] !== undefined) {
                throw new GebruikersFout(`Onbekend subcommando '${positioneel[0]}'. Zie: factory help`);
            }
            orkestreer({
                dry: schakelaars.has('--dry'),
                eenmalig: schakelaars.has('--eenmalig'),
                nacht: schakelaars.has('--nacht'),
                installeer: schakelaars.has('--installeer'),
                verwijder: schakelaars.has('--verwijder'),
                ...(issue === undefined ? {} : { issue }),
                ...(reeks === undefined ? {} : { reeks }),
            });
            return;
        }
        case 'opruimen': {
            const { schakelaars: opruimSchakelaars } = leesArgumenten(rest, {
                schakelaars: ['--dry'],
            });
            opruimen({ dry: opruimSchakelaars.has('--dry') });
            return;
        }
        case 'sync': {
            const { schakelaars } = leesArgumenten(rest, { schakelaars: ['--check'] });
            sync({ check: schakelaars.has('--check') });
            return;
        }
        case 'board': {
            const { positioneel } = leesArgumenten(rest);
            board(positioneel[0], positioneel[1]);
            return;
        }
        case 'afronden': {
            const { positioneel } = leesArgumenten(rest);
            afronden(positioneel[0], positioneel[1]);
            return;
        }
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
}
catch (error) {
    if (error instanceof GebruikersFout) {
        fout(error.message);
    }
    else {
        fout(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
}
//# sourceMappingURL=cli.js.map