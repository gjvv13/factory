import { vereisAppConfig, vereisOmgeving } from '../app-config.js';
import { GebruikersFout, ok } from '../shell.js';

interface FlagRij {
  readonly key: string;
  readonly enabled: boolean;
  readonly description: string;
}

/**
 * Feature flags aan- of uitzetten in een draaiende omgeving, zonder deploy.
 * De beheerroutes zitten op de loopback-interface van de applicatie.
 */
export async function flag(
  omgevingArgument: string | undefined,
  naam: string | undefined,
  stand: string | undefined,
): Promise<void> {
  const config = vereisAppConfig();
  const omgeving = vereisOmgeving(omgevingArgument);
  const basis = `http://127.0.0.1:${String(config.poorten[omgeving])}`;

  if (naam === undefined) {
    const antwoord = await fetch(`${basis}/admin/flags`);
    if (!antwoord.ok) {
      throw new GebruikersFout(
        `Kon de flags niet ophalen uit ${omgeving} (status ${String(antwoord.status)}). Draait die omgeving?`,
      );
    }
    const payload = (await antwoord.json()) as { flags: FlagRij[] };
    if (payload.flags.length === 0) {
      process.stdout.write(`(geen flags in ${omgeving})\n`);
      return;
    }
    for (const rij of payload.flags) {
      const stand = rij.enabled ? 'AAN' : 'uit';
      process.stdout.write(`${stand.padEnd(4)} ${rij.key.padEnd(24)} ${rij.description}\n`);
    }
    return;
  }

  const aan = stand === 'on' || stand === 'aan';
  const uit = stand === 'off' || stand === 'uit';
  if (!aan && !uit) {
    throw new GebruikersFout(`Gebruik: factory flag ${omgeving} <naam> on|off`);
  }

  const antwoord = await fetch(`${basis}/admin/flags/${encodeURIComponent(naam)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: aan }),
  });
  if (!antwoord.ok) {
    throw new GebruikersFout(
      `Flag zetten mislukte (status ${String(antwoord.status)}). Draait ${omgeving}?`,
    );
  }
  ok(`flag '${naam}' staat nu ${aan ? 'AAN' : 'uit'} in ${omgeving}`);
}
