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
/**
 * Wat een **bouw**-werker mag (#183). Wél schrijven — dat is de opdracht — maar niet
 * pushen en geen PR openen: de supervisor levert in met `factory inleveren
 * --geen-automerge`, zodat het openen van een PR een beslissing van de factory blijft en
 * niet van het model. Committen mag wel; zonder commit is er niets in te leveren.
 */
export const BOUWER_TOEGESTAAN = [
    'Read',
    'Grep',
    'Glob',
    'Write',
    'Edit',
    // De lees- en tmp-werkwoorden (#217). Ze geven geen macht die `Write` en `Edit` niet
    // al geven, en zonder deze zocht de werker omwegen: de eerste bouw-run (#87) liep
    // negen keer tegen een weigering aan, waarvan zes op `mkdir`, `cd` en `echo`. Die
    // omwegen zaten in zijn 58 beurten.
    'Bash(ls:*)',
    'Bash(cat:*)',
    'Bash(head:*)',
    'Bash(tail:*)',
    'Bash(wc:*)',
    'Bash(grep:*)',
    'Bash(echo:*)',
    'Bash(mkdir:*)',
    'Bash(mktemp:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)',
    'Bash(git status:*)',
    'Bash(git restore:*)',
    'Bash(pnpm:*)',
    'Bash(npx:*)',
    'Bash(node:*)',
    'Bash(gh issue view:*)',
    'Bash(gh api:*)',
];
/**
 * Wat een bouw-werker nooit mag. `git push` en `gh pr` staan hier omdat de PR de grens
 * is tussen voorstellen en landen; `gh project`/`gh issue edit` omdat het board van de
 * supervisor is. En `git checkout`/`switch`/`rebase` niet: hij werkt op één branch in
 * zijn eigen worktree, en van branch wisselen is per definitie buiten de opdracht.
 *
 * **`rm` staat hier bewust niet bij de toegestane werkwoorden** (#217), anders dan de
 * andere tmp-hulpmiddelen. `Write` kan alleen bestanden maken of overschrijven binnen de
 * werkmap; `rm -rf <pad>` kan de spiegel van een ándere applicatie wissen. "Alleen in
 * zijn eigen tmp-map" is niet in een patroon uit te drukken, want dat pad is per sessie
 * anders. Hij mag zijn rommel in tmp laten staan — het besturingssysteem ruimt die op.
 *
 * **`git -C` ook niet**: `Bash(git -C:*)` zou `git -C <pad> push` toestaan en daarmee
 * precies de grens omzeilen die hierboven staat. Git in zijn eigen werkmap kan hij wel.
 */
export const BOUWER_VERBODEN = [
    'Bash(git push:*)',
    'Bash(git checkout:*)',
    'Bash(git switch:*)',
    'Bash(git rebase:*)',
    'Bash(git reset:*)',
    'Bash(gh pr:*)',
    'Bash(gh issue edit:*)',
    'Bash(gh issue close:*)',
    'Bash(gh project:*)',
    'Bash(gh release:*)',
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
 * Het verdict van een bouw-run (#183). Het verschil met een refinement zit in het
 * bewijs: per acceptatiecriterium een regel met wat het aantoont. `bewijs` is
 * `min(1)`, dus een criterium zonder bewijs komt niet als `klaar` door de poort — dat
 * is precies de reden dat dit schema bestaat en niet alleen de prompt erom vraagt.
 */
const bouwVerdictSchema = z.discriminatedUnion('uitkomst', [
    z.object({
        uitkomst: z.literal('klaar'),
        samenvatting: z.string().min(1),
        criteria: z.array(z.object({ criterium: z.string().min(1), bewijs: z.string().min(1) })).min(1),
    }),
    z.object({
        uitkomst: z.literal('escalatie'),
        vraag: z.string().min(1),
        advies: z.string().min(1),
    }),
]);
/** Als `VERDICT_JSON_SCHEMA`, maar voor een bouw-run: plat, met de hand, om dezelfde redenen. */
export const BOUW_JSON_SCHEMA = {
    type: 'object',
    properties: {
        uitkomst: {
            type: 'string',
            enum: ['klaar', 'escalatie'],
            description: 'klaar = gebouwd, poort groen, elk criterium bewezen; escalatie = je hebt een vraag',
        },
        samenvatting: {
            type: 'string',
            description: 'alleen bij klaar: twee of drie zinnen over wat je deed en wat je aannam',
        },
        criteria: {
            type: 'array',
            description: 'alleen bij klaar: per acceptatiecriterium het criterium en het bewijs (test of commit). Kun je geen bewijs noemen, escaleer dan.',
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
    },
    required: ['uitkomst'],
    additionalProperties: false,
};
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
        // Hervatten of beginnen: `--resume` neemt de sessie-id van de bestaande sessie,
        // `--session-id` kent hem toe aan een nieuwe.
        ...(opdracht.hervat === true ? ['--resume', opdracht.sessie] : []),
        '-p',
        opdracht.prompt,
        '--output-format',
        'json',
        ...(opdracht.hervat === true ? [] : ['--session-id', opdracht.sessie]),
        '--model',
        opdracht.model,
        '--max-budget-usd',
        String(opdracht.budgetUsd),
        '--json-schema',
        JSON.stringify(opdracht.jsonSchema ?? VERDICT_JSON_SCHEMA),
        '--allowedTools',
        ...(opdracht.toegestaan ?? WERKER_TOEGESTAAN),
        '--disallowedTools',
        ...(opdracht.verboden ?? WERKER_VERBODEN),
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
function leesEnvelop(opdracht) {
    const uitkomst = run('claude', werkerArgumenten(opdracht), {
        cwd: opdracht.werkmap,
        capture: true,
        toleranter: true,
        ...(opdracht.env === undefined ? {} : { env: opdracht.env }),
    });
    let ruw;
    try {
        ruw = JSON.parse(uitkomst.stdout);
    }
    catch {
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
    const geweigerd = [...new Set((data.permission_denials ?? []).map((d) => d.tool_name))];
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
/**
 * Draait één bouw-werker (#183) en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Zelfde regels als bij een refinement: de uitkomst komt uit de JSON en nooit uit de
 * exitcode, en geen verdict is een mislukking en geen "waarschijnlijk gelukt". Het
 * verschil is het schema — een criterium zonder bewijs komt er niet als `klaar` door.
 */
export function draaiBouwer(opdracht) {
    const gelezen = leesEnvelop({
        ...opdracht,
        toegestaan: opdracht.toegestaan ?? BOUWER_TOEGESTAAN,
        verboden: opdracht.verboden ?? BOUWER_VERBODEN,
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
export function draaiWerker(opdracht) {
    const gelezen = leesEnvelop(opdracht);
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
function mislukt(sessie, fout) {
    return { afloop: 'mislukt', sessie, weigeringen: 0, fout };
}
//# sourceMappingURL=werker.js.map