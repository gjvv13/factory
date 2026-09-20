import { run, waarschuwing } from './shell.js';

/**
 * Configuratie voor een ops-room-melding via curl.
 *
 * Drie aanroepers (code-review, orkestreer-bouw, orkestreer) gebruikten
 * hetzelfde curl-POST-blok; deze module brengt dat samen (#606).
 */
export interface OpsMeldingConfig {
  readonly url: string;
  readonly token?: string;
  /** App-naam voor de meldingtekst. */
  readonly app?: string;
}

/**
 * Stuur een best-effort ops-room-melding via curl.
 *
 * - Zonder `url`: waarschuwing, geen aanroep.
 * - Met falende curl: waarschuwing, geen throw.
 */
export function meldOps(tekst: string, url: string | undefined, token?: string): void {
  if (url === undefined) {
    waarschuwing('ops-melding overgeslagen: geen DEPLOY_NOTIFY_URL geconfigureerd.');
    return;
  }

  const args = [
    // -f/--fail: curl geeft exit 0 bij een HTTP-foutstatus (401/403 bij een fout/ontbrekend
    // token, 404 bij een verkeerd pad, 5xx). Zonder deze vlag vangt `result.code !== 0`
    // alleen transport-/DNS-fouten en verdwijnt een afgewezen melding geruisloos — precies
    // de anti-stilte-garantie die dit hoort te borgen (#754, verwant #112). Met -f wordt een
    // HTTP-fout een non-nul exit en dus een zichtbare waarschuwing.
    '-f',
    '-s',
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    ...(token !== undefined ? ['-H', `Authorization: Bearer ${token}`] : []),
    '-d',
    JSON.stringify({ text: tekst }),
    url,
  ];
  const result = run('curl', args, { capture: true, toleranter: true });
  if (result.code !== 0) {
    waarschuwing(`ops-melding mislukt (curl exit ${String(result.code)}).`);
  }
}
