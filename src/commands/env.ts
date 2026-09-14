import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  OMGEVINGEN,
  pm2NaamVan,
  vereisAppConfig,
  vereisOmgeving,
  type AppConfig,
  type Omgeving,
} from '../app-config.js';
import { herstartOmgeving, toonGeladenConfig } from '../env-herstart.js';
import { GebruikersFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';

async function gezondheid(poort: number): Promise<string | undefined> {
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
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return undefined;
  }
}

function ecosystemPad(config: AppConfig): string {
  return path.join(config.appDir, 'environments', 'ecosystem.config.cjs');
}

/**
 * Leest de pm2-uptime (epoch ms) van een proces via `pm2 jlist`. Geeft undefined als
 * het proces niet draait of de output niet te parsen is.
 */
function pm2Uptime(pm2Naam: string): number | undefined {
  const json = uitvoerVan('pm2', ['jlist']);
  if (json === undefined) return undefined;
  try {
    const processen: unknown[] = JSON.parse(json) as unknown[];
    const proces = processen.find(
      (p): p is { pm2_env: { pm_uptime: number } } =>
        typeof p === 'object' &&
        p !== null &&
        'name' in p &&
        p.name === pm2Naam &&
        'pm2_env' in p &&
        typeof (p as { pm2_env: unknown }).pm2_env === 'object' &&
        (p as { pm2_env: unknown }).pm2_env !== null &&
        'pm_uptime' in (p as { pm2_env: Record<string, unknown> }).pm2_env &&
        typeof (p as { pm2_env: { pm_uptime: unknown } }).pm2_env.pm_uptime === 'number',
    );
    return proces?.pm2_env.pm_uptime;
  } catch {
    return undefined;
  }
}

/**
 * Playbook: env-stale — waarschuw als een env-bestand nieuwer is dan het pm2-proces (#669).
 */
function controleerEnvVersheid(config: AppConfig, omgeving: Omgeving, pm2Naam: string): void {
  const uptime = pm2Uptime(pm2Naam);
  if (uptime === undefined) return; // proces draait niet; niets te vergelijken
  const envMap = path.join(config.appDir, 'environments');
  const bestanden = [`${omgeving}.env`, `${omgeving}.secrets.env`];
  for (const bestand of bestanden) {
    const volledigPad = path.join(envMap, bestand);
    if (!existsSync(volledigPad)) continue;
    const mtime = statSync(volledigPad).mtimeMs;
    if (mtime > uptime) {
      waarschuwing(`${bestand} is nieuwer dan het proces — draai: factory env reload ${omgeving}`);
    }
  }
}

/** Omgevingen starten, stoppen en bekijken. */
export async function env(actie: string | undefined, omgevingArgument?: string): Promise<void> {
  const config = vereisAppConfig();
  mkdirSync(path.join(config.appDir, 'logs'), { recursive: true });
  mkdirSync(path.join(config.appDir, 'data'), { recursive: true });

  switch (actie ?? 'status') {
    case 'status': {
      run('pm2', ['list'], { toleranter: true });
      process.stdout.write('\n');
      for (const omgeving of OMGEVINGEN) {
        const poort = config.poorten[omgeving];
        const pm2Naam = pm2NaamVan(config, omgeving);
        const antwoord = await gezondheid(poort);
        if (antwoord === undefined) {
          waarschuwing(`${pm2Naam} (poort ${String(poort)}): niet bereikbaar`);
        } else {
          ok(`${pm2Naam} (poort ${String(poort)}): ${antwoord}`);
        }
        // Playbook: env-stale — waarschuw als een env-bestand nieuwer is dan het
        // pm2-proces, zodat de gebruiker weet dat hij `factory env reload` moet draaien (#669).
        controleerEnvVersheid(config, omgeving, pm2Naam);
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
      waarschuwing(
        'reload herstart direct: korte downtime, geen swap of rollback. Gebruik promote voor een veilige swap.',
      );
      herstartOmgeving(ecosystemPad(config), pm2Naam);
      toonGeladenConfig(config.appDir, omgeving);
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
