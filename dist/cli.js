#!/usr/bin/env node
import { env } from './commands/env.js';
import { flag } from './commands/flag.js';
import { nieuw } from './commands/nieuw.js';
import { promote } from './commands/promote.js';
import { release } from './commands/release.js';
import { sync } from './commands/sync.js';
import { verify } from './commands/verify.js';
import { fout, GebruikersFout } from './shell.js';
const HULP = `factory — pipeline van idee tot productie

  factory verify [--snel|--pre-commit]   kwaliteitspoort: opmaak, lint, types, tests, build
  factory release [patch|minor|major]    verify, versie verhogen, committen en taggen
  factory promote <acc|prod> [tag] [--ja] release-tag uitrollen en de omgeving herstarten
  factory env <status|start|stop|logs> [omgeving]
  factory flag <omgeving> [naam] [on|off]
  factory nieuw <naam> [--link]          nieuwe applicatie uit het skeleton
  factory sync [--check]                 slash commands en git hook gelijkzetten (--check: alleen signaleren)
`;
async function main(argumenten) {
    const [commando, ...rest] = argumenten;
    const vlaggen = new Set(rest.filter((argument) => argument.startsWith('--')));
    const positioneel = rest.filter((argument) => !argument.startsWith('--'));
    switch (commando) {
        case 'verify':
            verify({ snel: vlaggen.has('--snel'), preCommit: vlaggen.has('--pre-commit') });
            return;
        case 'release':
            release(positioneel[0]);
            return;
        case 'promote':
            await promote(positioneel[0], positioneel[1], { ja: vlaggen.has('--ja') });
            return;
        case 'env':
            await env(positioneel[0], positioneel[1]);
            return;
        case 'flag':
            await flag(positioneel[0], positioneel[1], positioneel[2]);
            return;
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