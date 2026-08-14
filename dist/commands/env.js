import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OMGEVINGEN, pm2NaamVan, vereisAppConfig, vereisOmgeving, } from '../app-config.js';
import { herstartOmgeving } from '../env-herstart.js';
import { GebruikersFout, kop, ok, run, waarschuwing } from '../shell.js';
async function gezondheid(poort) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, 2000);
        try {
            const antwoord = await fetch(`http://127.0.0.1:${String(poort)}/health`, {
                signal: controller.signal,
            });
            return antwoord.ok ? await antwoord.text() : undefined;
        }
        finally {
            clearTimeout(timer);
        }
    }
    catch {
        return undefined;
    }
}
function ecosystemPad(config) {
    return path.join(config.appDir, 'environments', 'ecosystem.config.cjs');
}
/** Omgevingen starten, stoppen en bekijken. */
export async function env(actie, omgevingArgument) {
    const config = vereisAppConfig();
    mkdirSync(path.join(config.appDir, 'logs'), { recursive: true });
    mkdirSync(path.join(config.appDir, 'data'), { recursive: true });
    switch (actie ?? 'status') {
        case 'status': {
            run('pm2', ['list'], { toleranter: true });
            process.stdout.write('\n');
            for (const omgeving of OMGEVINGEN) {
                const poort = config.poorten[omgeving];
                const antwoord = await gezondheid(poort);
                if (antwoord === undefined) {
                    waarschuwing(`${pm2NaamVan(config, omgeving)} (poort ${String(poort)}): niet bereikbaar`);
                }
                else {
                    ok(`${pm2NaamVan(config, omgeving)} (poort ${String(poort)}): ${antwoord}`);
                }
            }
            return;
        }
        case 'start': {
            const omgeving = vereisOmgeving(omgevingArgument);
            run('pm2', [
                'start',
                ecosystemPad(config),
                '--only',
                pm2NaamVan(config, omgeving),
                '--update-env',
            ]);
            run('pm2', ['save'], { capture: true, toleranter: true });
            return;
        }
        case 'stop': {
            const omgeving = vereisOmgeving(omgevingArgument);
            run('pm2', ['stop', pm2NaamVan(config, omgeving)]);
            return;
        }
        case 'reload': {
            // Verse delete+start, zodat een gewijzigde environments/<omgeving>.env(.secrets)
            // altijd meegaat — hetzelfde als `promote` doet. Anders dan `start` (dat alleen
            // vers is als het proces nog niet bestaat) herlaadt dit ook een draaiend proces.
            const omgeving = vereisOmgeving(omgevingArgument);
            const pm2Naam = pm2NaamVan(config, omgeving);
            kop(`Omgeving ${omgeving} herstarten (${config.naam})`);
            waarschuwing('reload herstart direct: korte downtime, geen swap of rollback. Gebruik promote voor een veilige swap.');
            herstartOmgeving(ecosystemPad(config), pm2Naam);
            ok(`${pm2Naam} vers herstart; controleer met: factory env status`);
            return;
        }
        case 'logs': {
            const omgeving = vereisOmgeving(omgevingArgument);
            run('pm2', ['logs', pm2NaamVan(config, omgeving)]);
            return;
        }
        default:
            throw new GebruikersFout('Gebruik: factory env <status|start|stop|reload|logs> [omgeving]');
    }
}
//# sourceMappingURL=env.js.map