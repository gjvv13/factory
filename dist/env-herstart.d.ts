/**
 * Verwijdert een bestaand pm2-proces en start het vers uit de ecosystem. Bewust
 * geen `pm2 restart --update-env`: dat herleest de ecosystem-env niet maar neemt de
 * env van deze CLI-aanroep over. Alleen een verse start leest de gewijzigde
 * `environments/<omgeving>.env(.secrets)` opnieuw in. `promote` en `env reload`
 * delen deze ene herstart, zodat de env-herlaad overal hetzelfde werkt.
 */
export declare function herstartOmgeving(ecosystem: string, pm2Naam: string): void;
