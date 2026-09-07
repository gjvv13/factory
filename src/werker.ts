import { z } from 'zod';
import { runAsync, waarschuwing } from './shell.js';
import { leesAgentGrenzen } from './agent-definitie.js';

/**
 * De onbemande werker: één `claude -p`-aanroep, en de vertaling van zijn uitvoer naar
 * een uitkomst waar de orkestrator op kan sturen (#104).
 *
 * Twee dingen liggen hier vast, en allebei omdat ze in de praktijk misgingen.
 *
 * **De uitkomst komt uit de JSON, nooit uit de exitcode.** Gemeten op 2026-08-19 met
 * `claude` 2.1.233: een run die zijn opdracht niet uitvoerde omdat elk schrijfrecht
 * geweigerd werd, eindigde met `exit 0`, `is_error: false` én `subtype: "success"`.
 * Een run die zijn budget overschreed eindigde juist mét `exit 1`. De exitcode zegt
 * dus in beide richtingen niets; het verdict zegt alles.
 *
 * **De werker schrijft niets.** Hij leest code en het issue, en levert de uitwerking
 * terug als data (`--json-schema`). De orkestrator zet die op GitHub. Daarmee heeft de
 * werker geen enkel schrijfrecht nodig — niet in de werkmap, niet op GitHub — en is
 * "hij kan niets kapotmaken" geen belofte maar een eigenschap van de aanroep.
 */

/**
 * De namen van de agent-definities in `agents/`. Elke definitie draagt zijn eigen
 * toolset en model; de orkestrator geeft alleen de naam mee via `--agent`.
 *
 * Voorheen stonden de toolsets hier als hardcoded constanten; die zijn verhuisd naar
 * de `.md`-bestanden in `agents/`, zodat ze via `factory sync` naar de apps propageren
 * en op één plek te onderhouden zijn (#365).
 */
export const AGENT_REFINER = 'refiner';
export const AGENT_BOUWER = 'bouwer';
export const AGENT_REVIEWER = 'reviewer';
export const AGENT_ACCEPTEERDER = 'accepteerder';

/**
 * De envelop die `claude --output-format json` teruggeeft, zoals hij er op
 * 2026-08-19 echt uitzag (zie `test/fixtures/claude-run*.json`, opgenomen runs).
 *
 * `result` staat er bewust als optioneel in: bij een afgebroken run ontbreekt het veld
 * volledig. Een schema dat het verplicht stelt zou "budget op" als "envelop wijkt af"
 * rapporteren, en dat is precies de verwarring die dit schema moet voorkomen.
 */
const envelopSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  // Bewust `string` en niet `uuid()`: die is streng op de RFC-variantbits, en de
  // sessie-id komt van ons eigen `--session-id`. Een afwijkende vorm zou dan een
  // geslaagde run als "envelop wijkt af" wegzetten — validatie die alleen kan schaden.
  session_id: z.string().min(1),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
  result: z.string().nullish(),
  structured_output: z.unknown().optional(),
  permission_denials: z
    .array(
      z.object({
        tool_name: z.string(),
        // `command` alleen optioneel: een geweigerde Bash-tool heeft het, een
        // geweigerde Write/Edit/MCP-tool heeft een `tool_input` zónder `command`.
        // Verplicht stellen zette een geslaagde run met zo'n weigering weg als
        // "envelop wijkt af" — precies de schade waar de comment hierboven tegen
        // waarschuwt. De consument (`weigeringLabel`) tolereert `undefined` al.
        tool_input: z.object({ command: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

/**
 * Het verdict, afgedwongen met `--json-schema` zodat de uitkomst niet uit proza
 * geraden hoeft te worden. `body` is de complete nieuwe issue-body; de orkestrator
 * schrijft hem, de werker niet.
 */
const verdictSchema = z.discriminatedUnion('uitkomst', [
  z.object({
    uitkomst: z.literal('klaar'),
    samenvatting: z.string().min(1),
    slices: z.number().int().nonnegative(),
    body: z.string().min(1),
  }),
  z.object({
    uitkomst: z.literal('escalatie'),
    vraag: z.string().min(1),
    advies: z.string().min(1),
  }),
]);

export type Verdict = z.infer<typeof verdictSchema>;

/**
 * Het verdict van een bouw-run (#183). Het verschil met een refinement zit in het
 * bewijs: per acceptatiecriterium een regel met wat het aantoont. `bewijs` is
 * `min(1)`, dus een criterium zonder bewijs komt niet als `klaar` door de poort — dat
 * is precies de reden dat dit schema bestaat en niet alleen de prompt erom vraagt.
 */
/** Eén wrijvingssignaal: wat moeite kostte en wat het zou verhelpen (#542). */
const wrijvingSchema = z.object({
  signaal: z.string().min(1),
  suggestie: z.string().min(1),
});

const bouwVerdictSchema = z.discriminatedUnion('uitkomst', [
  z.object({
    uitkomst: z.literal('klaar'),
    samenvatting: z.string().min(1),
    criteria: z.array(z.object({ criterium: z.string().min(1), bewijs: z.string().min(1) })).min(1),
    wrijving: z.array(wrijvingSchema).optional(),
  }),
  z.object({
    uitkomst: z.literal('escalatie'),
    vraag: z.string().min(1),
    advies: z.string().min(1),
    wrijving: z.array(wrijvingSchema).optional(),
  }),
]);

export type BouwVerdict = z.infer<typeof bouwVerdictSchema>;

/**
 * Het verdict van een review-run (#184). Geen discriminated union: de review is
 * altijd een oordeel met optionele bevindingen. Nul bevindingen is geldig — dat
 * betekent dat het werk er goed uitziet.
 */
const reviewBevindingSchema = z.object({
  bestand: z.string().min(1),
  regel: z.number().int().positive().optional(),
  ernst: z.enum(['laag', 'midden', 'hoog']),
  bevinding: z.string().min(1),
});

const reviewVerdictSchema = z.object({
  bevindingen: z.array(reviewBevindingSchema),
  oordeel: z.string().min(1),
});

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

/**
 * Het verdict van een accepteer-run (#178). Per acceptatiecriterium: is het
 * waargenomen, niet-waarneembaar of gefaald? Een `waargenomen` zonder bewijs
 * komt de `.refine()` niet door — dat is precies het punt: nooit een groen
 * vinkje op een onbewezen criterium.
 */
const accepteerCriteriumSchema = z
  .object({
    criterium: z.string().min(1),
    status: z.enum(['waargenomen', 'niet-waarneembaar', 'gefaald']),
    bewijs: z
      .object({
        aanroep: z.string().min(1),
        antwoord: z.string().min(1),
      })
      .optional(),
  })
  .refine((c) => c.status !== 'waargenomen' || c.bewijs !== undefined, {
    message: 'waargenomen vereist bewijs (aanroep + antwoord)',
  });

const accepteerVerdictSchema = z.discriminatedUnion('uitkomst', [
  z.object({
    uitkomst: z.literal('klaar'),
    criteria: z.array(accepteerCriteriumSchema).min(1),
  }),
  z.object({
    uitkomst: z.literal('escalatie'),
    vraag: z.string().min(1),
    advies: z.string().min(1),
  }),
]);

export type AccepteerVerdict = z.infer<typeof accepteerVerdictSchema>;

/** Het JSON-schema voor `claude --json-schema` bij een accepteer-run. */
export const ACCEPTEER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    uitkomst: {
      type: 'string',
      enum: ['klaar', 'escalatie'],
      description: 'klaar = alle criteria getoetst en gerapporteerd; escalatie = je hebt een vraag',
    },
    criteria: {
      type: 'array',
      description: 'alleen bij klaar: per acceptatiecriterium het resultaat met bewijs',
      items: {
        type: 'object',
        properties: {
          criterium: {
            type: 'string',
            description: 'het criterium zoals het in de issue-body staat',
          },
          status: {
            type: 'string',
            enum: ['waargenomen', 'niet-waarneembaar', 'gefaald'],
            description:
              'waargenomen = succesvol getoetst via acc; niet-waarneembaar = niet via HTTP te toetsen; gefaald = de aanroep faalde of gaf een onverwacht antwoord',
          },
          bewijs: {
            type: 'object',
            description: 'de acc-aanroep en het antwoord; verplicht bij waargenomen',
            properties: {
              aanroep: {
                type: 'string',
                description: 'de HTTP-aanroep (methode, URL, eventueel body)',
              },
              antwoord: {
                type: 'string',
                description: 'het antwoord van acc (statuscode + relevante body)',
              },
            },
            required: ['aanroep', 'antwoord'],
            additionalProperties: false,
          },
        },
        required: ['criterium', 'status'],
        additionalProperties: false,
      },
    },
    vraag: {
      type: 'string',
      description: 'alleen bij escalatie: wat je precies wilt weten',
    },
    advies: {
      type: 'string',
      description: 'alleen bij escalatie: wat jij zou doen en waarom',
    },
  },
  required: ['uitkomst'],
  additionalProperties: false,
} as const;

/** Als `BOUW_JSON_SCHEMA`, maar voor een review: plat, met de hand, om dezelfde redenen. */
export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    bevindingen: {
      type: 'array',
      description: 'lijst van bevindingen; een lege lijst is een geldige uitkomst',
      items: {
        type: 'object',
        properties: {
          bestand: { type: 'string', description: 'het bestand waar de bevinding in zit' },
          regel: { type: 'integer', description: 'optioneel: het regelnummer' },
          ernst: {
            type: 'string',
            enum: ['laag', 'midden', 'hoog'],
            description: 'ernst van de bevinding',
          },
          bevinding: { type: 'string', description: 'de bevinding zelf' },
        },
        required: ['bestand', 'ernst', 'bevinding'],
        additionalProperties: false,
      },
    },
    oordeel: {
      type: 'string',
      description: 'samenvatting: is het werk goed afgeleverd, en waarom wel of niet',
    },
  },
  required: ['bevindingen', 'oordeel'],
  additionalProperties: false,
} as const;

/** Als `VERDICT_JSON_SCHEMA`, maar voor een bouw-run: plat, met de hand, om dezelfde redenen. */
export const BOUW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    uitkomst: {
      type: 'string',
      enum: ['klaar', 'escalatie'],
      description:
        'klaar = gebouwd, poort groen, elk criterium bewezen; escalatie = je hebt een vraag',
    },
    samenvatting: {
      type: 'string',
      description: 'alleen bij klaar: twee of drie zinnen over wat je deed en wat je aannam',
    },
    criteria: {
      type: 'array',
      description:
        'alleen bij klaar: per acceptatiecriterium het criterium en het bewijs (test of commit). Kun je geen bewijs noemen, escaleer dan.',
      items: {
        type: 'object',
        properties: {
          criterium: { type: 'string' },
          bewijs: { type: 'string' },
        },
        required: ['criterium', 'bewijs'],
        additionalProperties: false,
      },
    },
    vraag: { type: 'string', description: 'alleen bij escalatie: wat je precies wilt weten' },
    advies: { type: 'string', description: 'alleen bij escalatie: wat jij zou doen en waarom' },
    wrijving: {
      type: 'array',
      description:
        'optioneel, beide varianten: wat je moeite of beurten kostte (signaal) en wat het zou oplossen (suggestie). Geen wrijving is een geldige uitkomst.',
      items: {
        type: 'object',
        properties: {
          signaal: { type: 'string' },
          suggestie: { type: 'string' },
        },
        required: ['signaal', 'suggestie'],
        additionalProperties: false,
      },
    },
  },
  required: ['uitkomst'],
  additionalProperties: false,
} as const;

/**
 * Het schema dat aan `claude --json-schema` meegaat — met de hand geschreven, en niet
 * `z.toJSONSchema(verdictSchema)`.
 *
 * Twee keer gemeten tegen de echte API (2026-08-19). `z.toJSONSchema` zet er een
 * `$schema`-sleutel in die de CLI weigert ("no schema with key or ref …"), en een
 * discriminated union wordt een kale `oneOf` zonder top-level `type` — dat geeft
 * HTTP 400 (`input_schema.type: Field required`). Dit schema is daarom plat: het
 * stuurt het model, en `verdictSchema` hierboven is de echte poort.
 */
export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    uitkomst: {
      type: 'string',
      enum: ['klaar', 'escalatie'],
      description: 'klaar = de uitwerking is af; escalatie = je hebt een vraag',
    },
    samenvatting: {
      type: 'string',
      description: 'alleen bij klaar: twee of drie zinnen over wat je deed en wat je aannam',
    },
    slices: { type: 'integer', description: 'alleen bij klaar: het aantal slices' },
    body: {
      type: 'string',
      description: 'alleen bij klaar: de complete nieuwe issue-body in markdown',
    },
    vraag: { type: 'string', description: 'alleen bij escalatie: wat je precies wilt weten' },
    advies: { type: 'string', description: 'alleen bij escalatie: wat jij zou doen en waarom' },
  },
  required: ['uitkomst'],
  additionalProperties: false,
} as const;

export interface WerkerOpdracht {
  readonly prompt: string;
  /** De werkmap: de spiegel van de applicatie, buiten `~/Documents`. */
  readonly werkmap: string;
  /** De sessie-id die de supervisor zelf toekent, zodat hervatten later kan. */
  readonly sessie: string;
  /**
   * Hervat een bestaande sessie in plaats van een nieuwe te beginnen.
   *
   * Gemeten op 2026-08-19: hervatten kostte $0,02 tegen $0,32 voor een verse run —
   * de context zit in de cache. Het werk tot de escalatie blijft dus staan, en het
   * antwoord is bijna gratis. Anders dan #104 aannam is hervatten **niet**
   * map-gebonden: het lukte ook vanuit een andere map. De werkmap blijft wel de
   * juiste plek om het te doen, want de werker leest daar de code.
   */
  readonly hervat?: boolean;
  /** Extra leesbare mappen, bijvoorbeeld de factory-spiegel met de templates. */
  readonly extraMappen?: readonly string[];
  readonly budgetUsd: number;
  /**
   * De agent-definitie uit `agents/` die de toolset en het model vastlegt (#365).
   * Vervangt de eerdere `model`-, `toegestaan`- en `verboden`-velden: die staan nu
   * in het frontmatter van de definitie en worden via `--agent` aan `claude` meegegeven.
   */
  readonly agent: string;
  /** Reasoning-effort, als `--effort` (#290); afwezig laat claude zijn eigen default kiezen. */
  readonly effort?: string;
  /**
   * Kap de run af na zoveel milliseconden (#206). Zonder grens hing een werker de hele
   * nacht: het slot blijft staan, de rij komt niet vooruit, en 's ochtends staat er één
   * regel in het log en verder niets.
   */
  readonly timeoutMs?: number;
  /**
   * De omgeving waarin `claude` draait. Onbemand staat hier de OAuth-token in: die
   * hoort niet in de LaunchAgent-plist (wereldleesbaar) maar in een 0600-bestand dat
   * de run zelf leest — zie `orkestrator-instellingen.ts`. Met de hand blijft dit
   * leeg en gebruikt `claude` de gewone keychain-auth.
   */
  readonly env?: NodeJS.ProcessEnv;
  /** Het uitvoerschema dat aan `--json-schema` meegaat; standaard dat van een refinement. */
  readonly jsonSchema?: unknown;
}

export type Afloop = 'klaar' | 'escalatie' | 'mislukt';

/**
 * Alles wat een run oplevert behalve zijn verdict. Gedeeld door de refine- en de
 * bouw-werker: de envelop is dezelfde, alleen de uitkomst-vorm verschilt.
 */
export interface WerkerBasis {
  readonly afloop: Afloop;
  /** Gezet als de sessie niet te hervatten was; dan helpt het antwoord-pad niet meer. */
  readonly sessieWeg?: boolean;
  readonly sessie: string;
  readonly kosten?: number;
  readonly beurten?: number;
  /** Hoe vaak een gereedschap geweigerd werd; 0 bij een schone run. */
  readonly weigeringen: number;
  /**
   * Wélke gereedschappen geweigerd werden, zonder dubbelen. Alleen een aantal is niet
   * bruikbaar: negen keer `git push` betekent dat de grens werkt, negen keer iets wat hij
   * nodig had betekent dat de lijst te krap is — en dat verschil zag je niet (gemeten bij
   * de eerste bouw-run, #87 op 2026-08-20).
   */
  readonly geweigerd?: readonly string[];
  /** Bij `mislukt`: waarom, in één regel die in een comment past. */
  readonly fout?: string;
  /**
   * Na hoeveel minuten de run is afgekapt; afwezig als hij dat niet is (#206).
   *
   * Eén veld in plaats van een losse vlag plus een getal: het runlog moet "afgekapt
   * (30 min)" kunnen schrijven in plaats van het algemene "mislukt", en op de tekst van
   * `fout` snuffelen breekt bij de eerste herformulering.
   */
  readonly afgekaptNaMinuten?: number;
}

export interface WerkerUitkomst extends WerkerBasis {
  readonly verdict?: Verdict;
}

/** De argumenten voor de `claude`-aanroep. Apart, zodat een test ze kan nalopen. */
export function werkerArgumenten(opdracht: WerkerOpdracht): string[] {
  // `--agent` ontdekt de rol aan het `name:`-veld en levert het rol-systeemprompt,
  // maar het subagent-formaat kan geen fijnmazige `Bash(git push:*)`-verboden. De
  // grens en het model borgen we daarom expliciet uit de definitie (#547): zo is de
  // agent-def de enige bron van waarheid én blijft de grens hard.
  const grenzen = leesAgentGrenzen(opdracht.agent);
  return [
    // Hervatten of beginnen: `--resume` neemt de sessie-id van de bestaande sessie,
    // `--session-id` kent hem toe aan een nieuwe.
    ...(opdracht.hervat === true ? ['--resume', opdracht.sessie] : []),
    '-p',
    opdracht.prompt,
    '--output-format',
    'json',
    ...(opdracht.hervat === true ? [] : ['--session-id', opdracht.sessie]),
    '--agent',
    opdracht.agent,
    ...(grenzen.model === undefined ? [] : ['--model', grenzen.model]),
    ...(grenzen.allowedTools.length === 0 ? [] : ['--allowedTools', ...grenzen.allowedTools]),
    ...(grenzen.disallowedTools.length === 0
      ? []
      : ['--disallowedTools', ...grenzen.disallowedTools]),
    ...(opdracht.effort === undefined ? [] : ['--effort', opdracht.effort]),
    '--max-budget-usd',
    String(opdracht.budgetUsd),
    '--json-schema',
    JSON.stringify(opdracht.jsonSchema ?? VERDICT_JSON_SCHEMA),
    ...(opdracht.extraMappen ?? []).flatMap((map) => ['--add-dir', map]),
  ];
}

/**
 * Draait één werker en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Elke uitkomst die `claude` teruggeeft levert een `WerkerUitkomst`, ook een kapotte:
 * de orkestrator moet de reden in een comment kunnen zetten en door naar het volgende
 * item. Eén ding gooit wél — een `claude` die niet te starten is. Dat is geen probleem
 * van dít item maar van de machine, en het escaleren van één issue zou dat verbergen
 * terwijl elke volgende run er net zo goed op stukloopt.
 */
/**
 * De envelop van één `claude`-aanroep, of een mislukte uitkomst.
 *
 * Apart van `draaiWerker` omdat de bouw-werker (#183) dezelfde envelop leest maar een
 * ander verdict verwacht. Alles wat hier misgaat — geen JSON, een verlopen sessie, een
 * afwijkende envelop, `is_error` — geldt voor beide even hard, en dat wil je op één
 * plek houden: het zijn allemaal gemeten valkuilen.
 */
/**
 * Het label van één geweigerd gereedschap, voor de voetnoot en de wrijvingsmelding.
 *
 * Voor een Bash-weigering het commando in plaats van kaal "Bash": zonder het commando
 * weet niemand wélke grens raakte, en dan is de rechtenlijst verbreden gokken (#290).
 * Samengevat tot het werkwoord — plus het subcommando bij `git`/`gh`/`pnpm`/`npx`/`node` —
 * zodat het label aansluit op de patronen in de rechtenlijst (`git push`, `chmod`).
 */
function weigeringLabel(denial: {
  readonly tool_name: string;
  readonly tool_input?: { readonly command?: string | undefined } | undefined;
}): string {
  const commando = denial.tool_input?.command;
  if (denial.tool_name !== 'Bash' || commando === undefined) {
    return denial.tool_name;
  }
  const woorden = commando.trim().split(/\s+/);
  const verb = woorden[0] ?? 'Bash';
  const metSubcommando = ['git', 'gh', 'pnpm', 'npx', 'node'];
  return metSubcommando.includes(verb) && woorden[1] !== undefined ? `${verb} ${woorden[1]}` : verb;
}

async function leesEnvelop(opdracht: WerkerOpdracht): Promise<
  | { readonly soort: 'mislukt'; readonly uitkomst: WerkerBasis }
  | {
      readonly soort: 'gelezen';
      readonly basis: Omit<WerkerBasis, 'afloop'>;
      readonly structured: unknown;
    }
> {
  const uitkomst = await runAsync('claude', werkerArgumenten(opdracht), {
    cwd: opdracht.werkmap,
    capture: true,
    toleranter: true,
    ...(opdracht.env === undefined ? {} : { env: opdracht.env }),
    ...(opdracht.timeoutMs === undefined ? {} : { timeoutMs: opdracht.timeoutMs }),
  });

  if (uitkomst.afgekapt) {
    // De async uitvoerder stuurt SIGTERM naar de hele procesgroep (`-pid`), dus
    // kleinkinderen die `spawnSync`'s timeout overleefden zijn nu ook dood (#224).
    const minuten = Math.round((opdracht.timeoutMs ?? 0) / 60_000);
    waarschuwing(
      `#${opdracht.prompt.match(/#(\d+)/)?.[0] ?? '?'} afgekapt na ${String(minuten)} minuten zonder uitkomst — procesgroep opgeruimd, de rij gaat door.`,
    );
    return {
      soort: 'mislukt',
      uitkomst: {
        ...mislukt(opdracht.sessie, `afgekapt na ${String(minuten)} minuten zonder uitkomst`),
        afgekaptNaMinuten: minuten,
      },
    };
  }

  let ruw: unknown;
  try {
    ruw = JSON.parse(uitkomst.stdout) as unknown;
  } catch {
    const alles = `${uitkomst.stdout}\n${uitkomst.stderr}`;
    if (alles.includes('No conversation found with session ID')) {
      return {
        soort: 'mislukt',
        uitkomst: { ...mislukt(opdracht.sessie, 'de sessie bestaat niet meer'), sessieWeg: true },
      };
    }
    const staart = (uitkomst.stderr === '' ? uitkomst.stdout : uitkomst.stderr).trim().slice(-300);
    return {
      soort: 'mislukt',
      uitkomst: mislukt(opdracht.sessie, `claude gaf geen leesbare JSON terug: ${staart}`),
    };
  }

  const envelop = envelopSchema.safeParse(ruw);
  if (!envelop.success) {
    return {
      soort: 'mislukt',
      uitkomst: mislukt(opdracht.sessie, `envelop van claude wijkt af: ${envelop.error.message}`),
    };
  }
  const data = envelop.data;
  const geweigerd = [...new Set((data.permission_denials ?? []).map(weigeringLabel))];
  const basis = {
    sessie: data.session_id,
    weigeringen: data.permission_denials?.length ?? 0,
    ...(geweigerd.length === 0 ? {} : { geweigerd }),
    ...(data.total_cost_usd === undefined ? {} : { kosten: data.total_cost_usd }),
    ...(data.num_turns === undefined ? {} : { beurten: data.num_turns }),
  };

  if (data.is_error) {
    const reden = (data.result ?? '').trim();
    return {
      soort: 'mislukt',
      uitkomst: {
        ...basis,
        afloop: 'mislukt',
        fout: `run mislukt: ${reden === '' ? data.subtype : reden.slice(0, 300)}`,
      },
    };
  }
  return { soort: 'gelezen', basis, structured: data.structured_output };
}

/** Wat een bouw-run oplevert: dezelfde envelop-informatie, een ander verdict. */
export interface BouwUitkomst extends WerkerBasis {
  readonly verdict?: BouwVerdict;
}

/**
 * Draait één bouw-werker (#183) en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Zelfde regels als bij een refinement: de uitkomst komt uit de JSON en nooit uit de
 * exitcode, en geen verdict is een mislukking en geen "waarschijnlijk gelukt". Het
 * verschil is het schema — een criterium zonder bewijs komt er niet als `klaar` door.
 */
export async function draaiBouwer(opdracht: WerkerOpdracht): Promise<BouwUitkomst> {
  const gelezen = await leesEnvelop({
    ...opdracht,
    jsonSchema: opdracht.jsonSchema ?? BOUW_JSON_SCHEMA,
  });
  if (gelezen.soort === 'mislukt') {
    return gelezen.uitkomst;
  }
  const verdict = bouwVerdictSchema.safeParse(gelezen.structured);
  if (!verdict.success) {
    // Een criterium zonder bewijs landt hier: het schema weigert het als `klaar`, en dan
    // is er geen uitkomst maar een mislukking — nooit een groen vinkje op een onbewezen
    // criterium.
    return {
      ...gelezen.basis,
      afloop: 'mislukt',
      fout: `geen bruikbaar bouw-verdict: ${verdict.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  return { ...gelezen.basis, afloop: verdict.data.uitkomst, verdict: verdict.data };
}

/** Wat een review-run oplevert: dezelfde envelop-informatie, een ander verdict. */
export interface ReviewUitkomst extends WerkerBasis {
  readonly verdict?: ReviewVerdict;
}

/**
 * Draait één review-werker (#184) en vertaalt zijn uitvoer naar een uitkomst.
 *
 * De reviewer is lees-alleen: dezelfde toestemmingslijst als de refine-werker, niet
 * die van de bouwer. Hij beoordeelt, hij repareert niet. Faalt de review-run, dan is
 * dat geen reden om het inleveren te blokkeren — de review is een extra poort, geen
 * voorwaarde.
 */
export async function draaiReviewer(opdracht: WerkerOpdracht): Promise<ReviewUitkomst> {
  const gelezen = await leesEnvelop({
    ...opdracht,
    jsonSchema: opdracht.jsonSchema ?? REVIEW_JSON_SCHEMA,
  });
  if (gelezen.soort === 'mislukt') {
    return gelezen.uitkomst;
  }
  const verdict = reviewVerdictSchema.safeParse(gelezen.structured);
  if (!verdict.success) {
    return {
      ...gelezen.basis,
      afloop: 'mislukt',
      fout: `geen bruikbaar review-verdict: ${verdict.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  return { ...gelezen.basis, afloop: 'klaar', verdict: verdict.data };
}

/** Wat een accepteer-run oplevert: dezelfde envelop-informatie, een ander verdict. */
export interface AccepteerUitkomst extends WerkerBasis {
  readonly verdict?: AccepteerVerdict;
}

/**
 * Draait één accepteer-werker (#178) en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Lees-alleen: dezelfde verbodslijst als de refine-werker, met `curl` voor de
 * HTTP-aanroepen naar acc. Een `waargenomen` zonder bewijs komt niet door de Zod-
 * `.refine()` en landt als `mislukt`.
 */
export async function draaiAccepteerder(opdracht: WerkerOpdracht): Promise<AccepteerUitkomst> {
  const gelezen = await leesEnvelop({
    ...opdracht,
    jsonSchema: opdracht.jsonSchema ?? ACCEPTEER_JSON_SCHEMA,
  });
  if (gelezen.soort === 'mislukt') {
    return gelezen.uitkomst;
  }
  const verdict = accepteerVerdictSchema.safeParse(gelezen.structured);
  if (!verdict.success) {
    return {
      ...gelezen.basis,
      afloop: 'mislukt',
      fout: `geen bruikbaar accepteer-verdict: ${verdict.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  return { ...gelezen.basis, afloop: verdict.data.uitkomst, verdict: verdict.data };
}

export async function draaiWerker(opdracht: WerkerOpdracht): Promise<WerkerUitkomst> {
  const gelezen = await leesEnvelop(opdracht);
  if (gelezen.soort === 'mislukt') {
    return gelezen.uitkomst;
  }
  const verdict = verdictSchema.safeParse(gelezen.structured);
  if (!verdict.success) {
    // Geen verdict betekent niet "waarschijnlijk gelukt". De geweigerde-rechten-run uit
    // de proef gaf `is_error: false` mét een net excuus in `result` — zonder verdict is
    // er geen bewijs dat er iets gebeurd is.
    return {
      ...gelezen.basis,
      afloop: 'mislukt',
      fout: `geen bruikbaar verdict in de uitvoer${gelezen.basis.weigeringen > 0 ? ` (${String(gelezen.basis.weigeringen)}× gereedschap geweigerd)` : ''}`,
    };
  }
  return { ...gelezen.basis, afloop: verdict.data.uitkomst, verdict: verdict.data };
}

function mislukt(sessie: string, fout: string): WerkerBasis {
  return { afloop: 'mislukt', sessie, weigeringen: 0, fout };
}
