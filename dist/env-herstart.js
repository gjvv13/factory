import { run } from './shell.js';
/**
 * Verwijdert een bestaand pm2-proces en start het vers uit de ecosystem. Bewust
 * geen `pm2 restart --update-env`: dat herleest de ecosystem-env niet maar neemt de
 * env van deze CLI-aanroep over. Alleen een verse start leest de gewijzigde
 * `environments/<omgeving>.env(.secrets)` opnieuw in. `promote` en `env reload`
 * delen deze ene herstart, zodat de env-herlaad overal hetzelfde werkt.
 */
export function herstartOmgeving(ecosystem, pm2Naam) {
    const bestaat = run('pm2', ['describe', pm2Naam], { capture: true, toleranter: true }).code === 0;
    if (bestaat) {
        run('pm2', ['delete', pm2Naam], { capture: true });
    }
    run('pm2', ['start', ecosystem, '--only', pm2Naam], { capture: true });
    run('pm2', ['save'], { capture: true, toleranter: true });
}
//# sourceMappingURL=env-herstart.js.map