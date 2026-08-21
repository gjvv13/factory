import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GebruikersFout, git, ok, run } from './shell.js';
/**
 * De spiegel-werkplaats waarin een onbemande werker draait (#104).
 *
 * Niet mijn werkkopie in `~/Documents`, om twee redenen die los van elkaar al
 * voldoende zijn. Ten eerste kán het niet: macOS schermt `~/Documents` met TCC af
 * voor achtergrondprocessen — daarom mijdt `factory integreer` die map ook al. Ten
 * tweede mág het niet: er lopen parallelle sessies in die werkkopieën, en een werker
 * die daar iets omzet draait het werk van iemand anders terug.
 *
 * De werkplaats is wegwerpbaar: vóór elke run wordt hij hard teruggezet op
 * `origin/main`. Wat je daar bewaart, ben je kwijt. Dat is geen tekortkoming maar de
 * hele opzet — een werker mag nooit op een half-afgemaakte staat verderbouwen.
 */
/** De wortel van alle werkplaatsen. Ligt in `$HOME`, en dus buiten `~/Documents`. */
export const werkplaatsWortel = path.join(os.homedir(), 'OrkestratorWerk');
/**
 * Waar de spiegel van één applicatie staat.
 *
 * `wortel` is er zodat een test met een tijdelijke map kan werken in plaats van met
 * de echte home-map; in productie staat hij altijd op `werkplaatsWortel`.
 */
export function werkplaatsVan(app, wortel = werkplaatsWortel) {
    return path.join(wortel, app);
}
/**
 * Of een pad buiten `~/Documents` ligt. De werker moet daar aantoonbaar wegblijven,
 * dus dat is een controle en geen aanname — zie het acceptatiecriterium bij #153.
 */
export function buitenDocumenten(pad) {
    const documenten = path.join(os.homedir(), 'Documents');
    const genormaliseerd = path.resolve(pad);
    return genormaliseerd !== documenten && !genormaliseerd.startsWith(`${documenten}${path.sep}`);
}
/**
 * Zorgt dat de spiegel van `app` bestaat en gelijk is aan `origin/main`.
 *
 * Ontbreekt hij, dan wordt hij gekloond met `gh` (de app-repo's zijn privé, dus dit
 * leunt op de bestaande `gh`-auth). Bestaat hij, dan `fetch` + `reset --hard`: geen
 * merge en geen rebase, want er valt niets te bewaren en een conflict zou de run
 * blokkeren op iets wat niemand ooit wil oplossen.
 *
 * Levert het pad van de werkplaats op.
 */
export function versWerkplaats(app, eigenaar, wortel = werkplaatsWortel) {
    const pad = werkplaatsVan(app, wortel);
    if (!buitenDocumenten(pad)) {
        // Onbereikbaar zolang `werkplaatsWortel` in $HOME ligt, maar dit is de aanname
        // waar de hele opzet op rust; als iemand het pad ooit verlegt, moet dat luid falen.
        throw new GebruikersFout(`Werkplaats ${pad} ligt binnen ~/Documents; dat mag niet.`);
    }
    if (!existsSync(path.join(pad, '.git'))) {
        mkdirSync(wortel, { recursive: true });
        run('gh', ['repo', 'clone', `${eigenaar}/${app}`, pad, '--', '--quiet'], {
            cwd: wortel,
            capture: true,
        });
        ok(`werkplaats ${pad} gekloond`);
        return pad;
    }
    git(['fetch', '-q', 'origin'], pad);
    git(['reset', '--hard', '-q', 'origin/main'], pad);
    ok(`werkplaats ${pad} ververst op origin/main`);
    return pad;
}
/**
 * Het pad waar bron-momentopnames naast een worktree komen.
 *
 * Naast de worktree, niet erin: een map ín de worktree zou door `verify` gelint en
 * opgemaakt worden (`prettier --check .` scant alles) en kan per ongeluk in een commit
 * belanden. `<worktree>-bron` valt er structureel buiten (#238).
 */
export function bronMappenVan(worktree) {
    return `${worktree}-bron`;
}
/**
 * Zet een wegwerp-momentopname van een bron-app naast de worktree (#238).
 *
 * De spiegel wordt ververst op `origin/main`, en `git archive` levert de bestanden
 * zonder `.git` — er is niets om vanuit de kopie naar te pushen. Faalt de clone of
 * het archive, dan is dat een harde fout vóór de run: half toegang is erger dan geen
 * toegang.
 *
 * Levert het pad van de momentopname op (`<bronWortel>/<bronApp>`).
 */
export function bronMomentopname(bronApp, bronWortel, eigenaar, wortel = werkplaatsWortel) {
    // Ververs de spiegel zodat de momentopname op origin/main staat, net als de worktree.
    const spiegel = versWerkplaats(bronApp, eigenaar, wortel);
    const doelMap = path.join(bronWortel, bronApp);
    mkdirSync(doelMap, { recursive: true });
    // `git archive --output` schrijft het archief naar een bestand, zodat we niet hoeven te
    // pipen — de uitvoerder is synchroon en heeft geen stdin. `tar xf` pakt het daarna uit.
    const archief = path.join(bronWortel, `${bronApp}.tar`);
    git(['archive', '--format=tar', '--output', archief, 'HEAD'], spiegel, { capture: true });
    run('tar', ['xf', archief, '-C', doelMap], { capture: true });
    rmSync(archief, { force: true });
    ok(`bron-momentopname ${bronApp} → ${doelMap}`);
    return doelMap;
}
/**
 * Ruimt de bron-map op. Bewust een eigen functie en niet een inline `rmSync`: de
 * aanroeper moet dit in een `finally` doen, en de intentie mag niet verdrinken in de
 * boilerplate.
 */
export function ruimBronMapOp(bronWortel) {
    rmSync(bronWortel, { recursive: true, force: true });
}
//# sourceMappingURL=werkplaats.js.map