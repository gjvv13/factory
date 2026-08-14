import { existsSync } from 'node:fs';
import path from 'node:path';
import { leesOmgevingsWaarden, type Omgeving } from './app-config.js';
import { kop, run, waarschuwing } from './shell.js';

/**
 * Verwijdert een bestaand pm2-proces en start het vers uit de ecosystem. Bewust
 * geen `pm2 restart --update-env`: dat herleest de ecosystem-env niet maar neemt de
 * env van deze CLI-aanroep over. Alleen een verse start leest de gewijzigde
 * `environments/<omgeving>.env(.secrets)` opnieuw in. `promote` en `env reload`
 * delen deze ene herstart, zodat de env-herlaad overal hetzelfde werkt.
 */
export function herstartOmgeving(ecosystem: string, pm2Naam: string): void {
  const bestaat = run('pm2', ['describe', pm2Naam], { capture: true, toleranter: true }).code === 0;
  if (bestaat) {
    run('pm2', ['delete', pm2Naam], { capture: true });
  }
  run('pm2', ['start', ecosystem, '--only', pm2Naam], { capture: true });
  run('pm2', ['save'], { capture: true, toleranter: true });
}

export interface ConfigSamenvatting {
  /** De environments-map waaruit geladen is (de dev-repo, niet de clone). */
  readonly map: string;
  /** De env-bestanden die daadwerkelijk bestaan, in leesvolgorde. */
  readonly bestanden: string[];
  /** De namen van de geladen sleutels, gesorteerd — nooit de waarden. */
  readonly sleutels: string[];
  /** Sleutels die wél gezet zijn maar leeg (of alleen whitespace). */
  readonly legeSleutels: string[];
}

/**
 * Vat samen welke env-config een (her)start heeft ingelezen: uit welke map en
 * bestanden, welke sleutels, en welke daarvan leeg zijn. Bewust alléén sleutelnamen
 * en geen waarden — namen zijn geen geheim, waarden (tokens, sleutels) wel.
 */
export function configSamenvatting(appDir: string, omgeving: Omgeving): ConfigSamenvatting {
  const map = path.join(appDir, 'environments');
  const bestanden = [`${omgeving}.env`, `${omgeving}.secrets.env`].filter((bestand) =>
    existsSync(path.join(map, bestand)),
  );
  const waarden = leesOmgevingsWaarden(appDir, omgeving);
  const sleutels = Object.keys(waarden).sort();
  const legeSleutels = sleutels.filter((sleutel) => (waarden[sleutel] ?? '').trim() === '');
  return { map, bestanden, sleutels, legeSleutels };
}

/**
 * Toont welke config een (her)start heeft ingelezen, zodat een gemiste env/secret
 * meteen zichtbaar is in plaats van stil weg te vallen. Print het herkomst-pad en
 * de sleutelnamen (nooit waarden) en waarschuwt bij lege waarden.
 */
export function toonGeladenConfig(appDir: string, omgeving: Omgeving): void {
  const { map, bestanden, sleutels, legeSleutels } = configSamenvatting(appDir, omgeving);
  kop('Geladen config');
  if (bestanden.length === 0) {
    waarschuwing(`geen env-bestanden gevonden in ${map} — de omgeving draait op standaardwaarden`);
    return;
  }
  process.stdout.write(`  uit ${map} — ${bestanden.join(' + ')}\n`);
  process.stdout.write(`  ${String(sleutels.length)} sleutels: ${sleutels.join(', ')}\n`);
  for (const leeg of legeSleutels) {
    waarschuwing(`${leeg} is leeg`);
  }
}
