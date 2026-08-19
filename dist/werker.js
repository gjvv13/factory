import { z } from 'zod';
import { run } from './shell.js';
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
 * Wat de werker mag. Bewust een toestemmingslijst en niet alleen een verbodslijst:
 * met alléén `Write` en `Edit` verboden schrijft het model gewoon via
 * `Bash(echo … > bestand)` — dat is precies wat de proefrun deed. In een `-p`-sessie
 * kan niets goedgekeurd worden wat hier niet in staat, dus deze lijst ís de grens.
 */
export const WERKER_TOEGESTAAN = [
    'Read',
    'Grep',
    'Glob',
    'Bash(gh issue view:*)',
    'Bash(gh api:*)',
    'Bash(git log:*)',
    'Bash(git show:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
];
/** Wat de werker sowieso niet mag, ook niet als de lijst hierboven ooit uitdijt. */
export const WERKER_VERBODEN = [
    'Write',
    'Edit',
    'NotebookEdit',
    'Bash(git push:*)',
    'Bash(git commit:*)',
    'Bash(gh pr:*)',
    'Bash(gh issue edit:*)',
    'Bash(gh issue close:*)',
    'Bash(gh project:*)',
];
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
    permission_denials: z.array(z.object({ tool_name: z.string() })).optional(),
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
};
/** De argumenten voor de `claude`-aanroep. Apart, zodat een test ze kan nalopen. */
export function werkerArgumenten(opdracht) {
    return [
        '-p',
        opdracht.prompt,
        '--output-format',
        'json',
        '--session-id',
        opdracht.sessie,
        '--model',
        opdracht.model,
        '--max-budget-usd',
        String(opdracht.budgetUsd),
        '--json-schema',
        JSON.stringify(VERDICT_JSON_SCHEMA),
        '--allowedTools',
        ...WERKER_TOEGESTAAN,
        '--disallowedTools',
        ...WERKER_VERBODEN,
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
export function draaiWerker(opdracht) {
    const uitkomst = run('claude', werkerArgumenten(opdracht), {
        cwd: opdracht.werkmap,
        capture: true,
        toleranter: true,
    });
    let ruw;
    try {
        ruw = JSON.parse(uitkomst.stdout);
    }
    catch {
        const staart = (uitkomst.stderr === '' ? uitkomst.stdout : uitkomst.stderr).trim().slice(-300);
        return mislukt(opdracht.sessie, `claude gaf geen leesbare JSON terug: ${staart}`);
    }
    const envelop = envelopSchema.safeParse(ruw);
    if (!envelop.success) {
        // Een luide fout, geen stille aanname: verandert de vorm van de envelop door een
        // CLI-update, dan mag een mislukte run niet als "klaar" doorgaan.
        return mislukt(opdracht.sessie, `envelop van claude wijkt af: ${envelop.error.message}`);
    }
    const data = envelop.data;
    const basis = {
        sessie: data.session_id,
        weigeringen: data.permission_denials?.length ?? 0,
        ...(data.total_cost_usd === undefined ? {} : { kosten: data.total_cost_usd }),
        ...(data.num_turns === undefined ? {} : { beurten: data.num_turns }),
    };
    if (data.is_error) {
        // Niet op `subtype` sturen: bij een API-fout stond daar gewoon "success", terwijl
        // `result` de echte reden droeg ("API Error: 400 …"). Vandaar deze volgorde.
        const reden = (data.result ?? '').trim();
        return {
            ...basis,
            afloop: 'mislukt',
            fout: `run mislukt: ${reden === '' ? data.subtype : reden.slice(0, 300)}`,
        };
    }
    const verdict = verdictSchema.safeParse(data.structured_output);
    if (!verdict.success) {
        // Geen verdict betekent niet "waarschijnlijk gelukt". De geweigerde-rechten-run uit
        // de proef gaf `is_error: false` mét een net excuus in `result` — zonder verdict is
        // er geen bewijs dat er iets gebeurd is.
        return {
            ...basis,
            afloop: 'mislukt',
            fout: `geen bruikbaar verdict in de uitvoer${basis.weigeringen > 0 ? ` (${String(basis.weigeringen)}× gereedschap geweigerd)` : ''}`,
        };
    }
    return { ...basis, afloop: verdict.data.uitkomst, verdict: verdict.data };
}
function mislukt(sessie, fout) {
    return { afloop: 'mislukt', sessie, weigeringen: 0, fout };
}
//# sourceMappingURL=werker.js.map