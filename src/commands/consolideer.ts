/**
 * `factory consolideer` — wekelijkse memory-consolidatie (#372).
 *
 * Vier submodi:
 * - `--dry`: draai een headless Claude-run die een voorstel genereert
 * - `--voer-uit`: voer een eerder voorstel mechanisch uit
 * - `--installeer`: zet de LaunchAgent op
 * - `--verwijder`: haal de LaunchAgent weg
 *
 * Het voorstel verschijnt als sectie in `factory brief`; pas na goedkeuring
 * voert `--voer-uit` de acties uit. Geen tweede Claude-run, geen chat-koppeling.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  CONSOLIDEER_LAUNCH_LABEL,
  leesInstellingen,
  standaardPaden,
  TOKEN_SLEUTEL,
  vereisToken,
  zorgVoorEnvBestand,
  type OrkestratorPaden,
} from '../orkestrator-instellingen.js';
import { bouwNachtScript, nieuwsteTag, vereisNachtModus } from './orkestreer.js';
import { isBacklogRepo } from '../board.js';
import { GebruikersFout, kop, ok, run, runAsync, uitvoerVan } from '../shell.js';

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

/** Dag van de week waarop de LaunchAgent draait: maandag. */
const CONSOLIDEER_DAG = 1;
/** Uur waarop de LaunchAgent draait: 09:00. */
const CONSOLIDEER_UUR = 9;
/** Minuut waarop de LaunchAgent draait. */
const CONSOLIDEER_MINUUT = 0;

/** Maximale leeftijd van een voorstel in milliseconden (7 dagen). */
export const VOORSTEL_VERVALT_MS = 7 * 24 * 3_600_000;

/** Default projectpad als `FACTORY_GEHEUGEN_PROJECT` niet is gezet. */
const DEFAULT_GEHEUGEN_PROJECT = '/Users/gjvv/Documents/Software';

// ---------------------------------------------------------------------------
// Voorstelschema
// ---------------------------------------------------------------------------

const actieSchema = z.object({
  soort: z.enum(['verwijder', 'herschrijf', 'samenvoeg']),
  pad: z.string().min(1),
  reden: z.string().min(1),
  nieuwePad: z.string().optional(),
  nieuweInhoud: z.string().optional(),
});

export const voorstelSchema = z.object({
  aangemaakt: z.string().min(1),
  geheugenMap: z.string().min(1),
  acties: z.array(actieSchema),
  indexRegels: z.array(z.string()),
  samenvatting: z.string().min(1),
});

export type ConsolidatieVoorstel = z.infer<typeof voorstelSchema>;

/** Het JSON-schema dat aan `claude --json-schema` meegaat voor de dry-run. */
export const CONSOLIDEER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    aangemaakt: {
      type: 'string',
      description: 'ISO-tijdstip van de dry-run',
    },
    geheugenMap: {
      type: 'string',
      description: 'absoluut pad naar de memory-map (door Claude ontdekt)',
    },
    acties: {
      type: 'array',
      description: 'de voorgestelde acties op de geheugenbestanden',
      items: {
        type: 'object',
        properties: {
          soort: {
            type: 'string',
            enum: ['verwijder', 'herschrijf', 'samenvoeg'],
          },
          pad: {
            type: 'string',
            description: 'relatief aan geheugenMap',
          },
          reden: { type: 'string' },
          nieuwePad: {
            type: 'string',
            description: 'bij samenvoeg: doelbestand',
          },
          nieuweInhoud: {
            type: 'string',
            description: 'bij herschrijf/samenvoeg: nieuwe body',
          },
        },
        required: ['soort', 'pad', 'reden'],
        additionalProperties: false,
      },
    },
    indexRegels: {
      type: 'array',
      description: 'volledige nieuwe MEMORY.md-inhoud, regel voor regel',
      items: { type: 'string' },
    },
    samenvatting: {
      type: 'string',
      description: 'mensleesbare samenvatting voor de brief',
    },
  },
  required: ['aangemaakt', 'geheugenMap', 'acties', 'indexRegels', 'samenvatting'],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Voorstel lezen/schrijven
// ---------------------------------------------------------------------------

/**
 * Leest het voorstelbestand. Robuust: ontbrekend of onparseerbaar → undefined.
 * Geeft ook undefined terug als het voorstel ouder is dan 7 dagen.
 */
export function leesVoorstel(
  paden: OrkestratorPaden,
  nu: Date = new Date(Date.now()),
): ConsolidatieVoorstel | undefined {
  if (!existsSync(paden.consolideerVoorstelPad)) return undefined;
  let ruw: unknown;
  try {
    ruw = JSON.parse(readFileSync(paden.consolideerVoorstelPad, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  const gelezen = voorstelSchema.safeParse(ruw);
  if (!gelezen.success) return undefined;
  if (nu.getTime() - new Date(gelezen.data.aangemaakt).getTime() >= VOORSTEL_VERVALT_MS) {
    return undefined;
  }
  return gelezen.data;
}

/**
 * Leest het voorstelbestand zonder vervaltijd-controle. Wordt gebruikt bij
 * `--voer-uit` waar een eigen foutmelding bij een verlopen voorstel hoort.
 */
export function leesVoorstelRuw(paden: OrkestratorPaden): ConsolidatieVoorstel | undefined {
  if (!existsSync(paden.consolideerVoorstelPad)) return undefined;
  let ruw: unknown;
  try {
    ruw = JSON.parse(readFileSync(paden.consolideerVoorstelPad, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  const gelezen = voorstelSchema.safeParse(ruw);
  if (!gelezen.success) return undefined;
  return gelezen.data;
}

export function schrijfVoorstel(paden: OrkestratorPaden, voorstel: ConsolidatieVoorstel): void {
  mkdirSync(path.dirname(paden.consolideerVoorstelPad), { recursive: true });
  writeFileSync(paden.consolideerVoorstelPad, `${JSON.stringify(voorstel, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Voorstel valideren voor uitvoering
// ---------------------------------------------------------------------------

/**
 * Controleert of alle paden uit het voorstel nog bestaan. Geeft de naam van
 * het eerste ontbrekende bestand terug, of undefined als alles er is.
 */
export function eersteOntbrekendPad(voorstel: ConsolidatieVoorstel): string | undefined {
  for (const actie of voorstel.acties) {
    const absoluut = path.resolve(voorstel.geheugenMap, actie.pad);
    if (!existsSync(absoluut)) return actie.pad;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Voorstel uitvoeren
// ---------------------------------------------------------------------------

/**
 * Voert de acties uit het voorstel mechanisch uit. Geen Claude-run, geen
 * beoordeling — puur bestandsmanipulatie.
 */
export function voerVoorstelUit(voorstel: ConsolidatieVoorstel): void {
  for (const actie of voorstel.acties) {
    const absoluut = path.resolve(voorstel.geheugenMap, actie.pad);
    switch (actie.soort) {
      case 'verwijder':
        unlinkSync(absoluut);
        ok(`verwijderd: ${actie.pad}`);
        break;
      case 'herschrijf':
        if (actie.nieuweInhoud === undefined) {
          throw new GebruikersFout(
            `actie 'herschrijf' op ${actie.pad} mist nieuweInhoud — het voorstel is ongeldig.`,
          );
        }
        writeFileSync(absoluut, actie.nieuweInhoud);
        ok(`herschreven: ${actie.pad}`);
        break;
      case 'samenvoeg': {
        if (actie.nieuwePad === undefined || actie.nieuweInhoud === undefined) {
          throw new GebruikersFout(
            `actie 'samenvoeg' op ${actie.pad} mist nieuwePad of nieuweInhoud — het voorstel is ongeldig.`,
          );
        }
        const doelPad = path.resolve(voorstel.geheugenMap, actie.nieuwePad);
        writeFileSync(doelPad, actie.nieuweInhoud);
        unlinkSync(absoluut);
        ok(`samengevoegd: ${actie.pad} → ${actie.nieuwePad}`);
        break;
      }
    }
  }

  // MEMORY.md hergeneren
  const memoryPad = path.join(voorstel.geheugenMap, 'MEMORY.md');
  writeFileSync(memoryPad, voorstel.indexRegels.join('\n'));
  ok('MEMORY.md hergenereerd.');
}

// ---------------------------------------------------------------------------
// LaunchAgent-plist (#372)
// ---------------------------------------------------------------------------

/**
 * Bouwt de plist voor de consolideer-agent. Hergebruikt `bouwNachtScript` voor het
 * self-update-gedeelte. Het verschil met de orkestrator-plist: `StartCalendarInterval`
 * heeft een `Weekday` (maandag), en het commando is `factory consolideer --dry`.
 */
export function bouwConsolideerPlist(opzet: {
  readonly bin: string;
  readonly werkmap: string;
  readonly logPad: string;
  readonly pad?: string;
}): string {
  const padEnv = opzet.pad ?? process.env.PATH ?? '/usr/bin:/bin';
  // bouwNachtScript leest alleen `nachtCommando` uit de opzet; de overige velden
  // zijn verplicht door het gedeelde type maar worden niet gebruikt in het script.
  const script = bouwNachtScript({
    bin: opzet.bin,
    werkmap: opzet.werkmap,
    logPad: opzet.logPad,
    label: CONSOLIDEER_LAUNCH_LABEL,
    uur: CONSOLIDEER_UUR,
    minuut: CONSOLIDEER_MINUUT,
    nachtCommando: `"${opzet.bin}" consolideer --dry`,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${CONSOLIDEER_LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${script}</string>
  </array>
  <key>WorkingDirectory</key><string>${opzet.werkmap}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>${String(CONSOLIDEER_DAG)}</integer><key>Hour</key><integer>${String(CONSOLIDEER_UUR)}</integer><key>Minute</key><integer>${String(CONSOLIDEER_MINUUT)}</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${padEnv}</string></dict>
  <key>StandardOutPath</key><string>${opzet.logPad}</string>
  <key>StandardErrorPath</key><string>${opzet.logPad}</string>
</dict>
</plist>
`;
}

// ---------------------------------------------------------------------------
// Het commando zelf
// ---------------------------------------------------------------------------

export interface ConsolideerOpties {
  readonly dry?: boolean;
  readonly voerUit?: boolean;
  readonly installeer?: boolean;
  readonly verwijder?: boolean;
}

export async function consolideer(opties: ConsolideerOpties): Promise<void> {
  const paden = standaardPaden();

  if (opties.installeer === true) {
    installeerConsolideerAgent(paden);
    return;
  }
  if (opties.verwijder === true) {
    verwijderConsolideerAgent(paden);
    return;
  }
  if (opties.voerUit === true) {
    voerUit(paden);
    return;
  }
  if (opties.dry === true) {
    await dryRun(paden);
    return;
  }
  throw new GebruikersFout(
    'Geef een modus op: --dry, --voer-uit, --installeer of --verwijder.\n' +
      '  factory consolideer --dry         voorstel genereren via Claude\n' +
      '  factory consolideer --voer-uit    voorstel doorvoeren\n' +
      '  factory consolideer --installeer  LaunchAgent opzetten\n' +
      '  factory consolideer --verwijder   LaunchAgent verwijderen',
  );
}

// ---------------------------------------------------------------------------
// --dry: headless Claude-run
// ---------------------------------------------------------------------------

async function dryRun(paden: OrkestratorPaden): Promise<void> {
  const instellingen = leesInstellingen(paden);
  vereisToken(instellingen, paden);

  const projectPad = instellingen.geheugenProject ?? DEFAULT_GEHEUGEN_PROJECT;
  kop('Geheugenconsolidatie dry-run');
  ok(`projectpad: ${projectPad}`);

  const prompt = [
    'Je bent een geheugenconsolidatie-assistent. Analyseer de geheugenbestanden',
    '(.claude/ memory-bestanden en MEMORY.md in dit project) en geef een voorstel',
    'voor opschoning: welke bestanden duplicaten bevatten, welke verouderde feiten',
    'bevatten, en hoe de MEMORY.md-index verbeterd kan worden.',
    '',
    'Geef je analyse als gestructureerde data in het gevraagde JSON-schema.',
    'Het veld "aangemaakt" vul je met het huidige ISO-tijdstip.',
    'Het veld "geheugenMap" is het absolute pad naar de map met geheugenbestanden.',
    'Paden in "acties" zijn relatief aan "geheugenMap".',
    '"indexRegels" is de volledige nieuwe inhoud van MEMORY.md, regel voor regel.',
  ].join('\n');

  const uitkomst = await runAsync(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--allowedTools',
      'Read',
      'Glob',
      'Grep',
      '--json-schema',
      JSON.stringify(CONSOLIDEER_JSON_SCHEMA),
    ],
    {
      cwd: projectPad,
      capture: true,
      toleranter: true,
      env: {
        ...process.env,
        [TOKEN_SLEUTEL]: instellingen.token,
      },
    },
  );

  let ruw: unknown;
  try {
    ruw = JSON.parse(uitkomst.stdout) as unknown;
  } catch {
    throw new GebruikersFout(
      `Claude gaf geen leesbare JSON terug. stderr: ${uitkomst.stderr.trim().slice(-300)}`,
    );
  }

  // De envelop van `claude --output-format json` bevat `structured_output`.
  const envelop = ruw as Record<string, unknown>;
  const structured = envelop['structured_output'] ?? ruw;

  const gelezen = voorstelSchema.safeParse(structured);
  if (!gelezen.success) {
    const details = gelezen.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GebruikersFout(`Het voorstel van Claude is ongeldig: ${details}`);
  }

  schrijfVoorstel(paden, gelezen.data);
  ok(`voorstel opgeslagen: ${paden.consolideerVoorstelPad}`);
  ok(`${String(gelezen.data.acties.length)} acties. Bekijk het met \`factory brief\`.`);
  ok('Doorvoeren: `factory consolideer --voer-uit`');
}

// ---------------------------------------------------------------------------
// --voer-uit: mechanische uitvoering
// ---------------------------------------------------------------------------

function voerUit(paden: OrkestratorPaden): void {
  kop('Geheugenconsolidatie uitvoeren');

  const voorstel = leesVoorstelRuw(paden);
  if (voorstel === undefined) {
    throw new GebruikersFout(
      `Geen voorstel gevonden op ${paden.consolideerVoorstelPad}.\n` +
        '  Draai eerst: factory consolideer --dry',
    );
  }

  // Vervaltijd controleren
  const leeftijdMs = Date.now() - new Date(voorstel.aangemaakt).getTime();
  if (leeftijdMs >= VOORSTEL_VERVALT_MS) {
    const dagen = Math.floor(leeftijdMs / (24 * 3_600_000));
    throw new GebruikersFout(
      `Het voorstel is ${String(dagen)} dagen oud (max 7). Draai opnieuw: factory consolideer --dry`,
    );
  }

  // Bestandscontrole
  const ontbrekend = eersteOntbrekendPad(voorstel);
  if (ontbrekend !== undefined) {
    throw new GebruikersFout(
      `Bestand "${ontbrekend}" uit het voorstel bestaat niet meer in ${voorstel.geheugenMap}.\n` +
        '  De geheugenbestanden zijn tussentijds gewijzigd. Draai opnieuw: factory consolideer --dry',
    );
  }

  voerVoorstelUit(voorstel);

  // Na succesvolle uitvoering: voorstelbestand verwijderen
  rmSync(paden.consolideerVoorstelPad, { force: true });
  ok('Voorstelbestand verwijderd — klaar.');
}

// ---------------------------------------------------------------------------
// --installeer / --verwijder
// ---------------------------------------------------------------------------

function installeerConsolideerAgent(paden: OrkestratorPaden): void {
  const cwd = process.cwd();
  if (!isBacklogRepo(cwd)) {
    throw new GebruikersFout(
      'Draai dit in de factory-repo: de globale bin komt uit de release-tags daarvan.',
    );
  }

  kop('Instellingen en token');
  zorgVoorEnvBestand(paden);
  const instellingen = leesInstellingen(paden);
  vereisToken(instellingen, paden);
  ok(`token aanwezig (${paden.envPad}).`);

  kop('Factory globaal installeren');
  // nieuwsteTag doet een `git fetch --tags` en controleert dat er een release-tag is;
  // het resultaat zelf is niet nodig, want de globale bin is al geïnstalleerd.
  nieuwsteTag(cwd);
  const npmPrefix = uitvoerVan('npm', ['prefix', '-g'], cwd) ?? '/usr/local';
  const bin = path.join(npmPrefix, 'bin', 'factory');
  vereisNachtModus(bin);

  kop('LaunchAgent laden');
  const agentPad = paden.consolideerAgentPad;
  mkdirSync(path.dirname(agentPad), { recursive: true });
  writeFileSync(
    agentPad,
    bouwConsolideerPlist({
      bin,
      werkmap: os.homedir(),
      logPad: paden.consolideerLogPad,
    }),
  );
  run('launchctl', ['unload', agentPad], { toleranter: true, capture: true });
  run('launchctl', ['load', agentPad]);
  ok(
    `geladen; \`factory consolideer --dry\` draait elke maandag om ${String(CONSOLIDEER_UUR).padStart(2, '0')}:${String(CONSOLIDEER_MINUUT).padStart(2, '0')} (log: ${paden.consolideerLogPad}).`,
  );
}

function verwijderConsolideerAgent(paden: OrkestratorPaden): void {
  kop('Consolideer-LaunchAgent verwijderen');
  const agentPad = paden.consolideerAgentPad;
  run('launchctl', ['unload', agentPad], { toleranter: true, capture: true });
  rmSync(agentPad, { force: true });
  ok('verwijderd; er draait niets meer vanzelf.');
}
