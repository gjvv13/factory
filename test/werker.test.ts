import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { herstelAsyncUitvoerder, stelAsyncUitvoerderIn } from '../src/shell.js';
import {
  ACCEPTEER_TOEGESTAAN,
  BOUWER_TOEGESTAAN,
  draaiBouwer,
  draaiWerker,
  werkerArgumenten,
  WERKER_TOEGESTAAN,
  WERKER_VERBODEN,
  type WerkerOpdracht,
} from '../src/werker.js';
import { maakAsyncUitvoerderOpnemer } from './helpers.js';

/**
 * Contract met de `claude` CLI — een dienst van derden, dus geen Pact maar een
 * opgenomen respons plus een schema. De fixtures zijn **echte** uitvoer van
 * `claude` 2.1.233, opgenomen op 2026-08-19; verandert de vorm door een CLI-update,
 * dan hoort dat hier rood te worden en niet stil als "klaar" door te gaan.
 */
function fixture(naam: string): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, 'fixtures', naam), 'utf8');
}

const OPDRACHT: WerkerOpdracht = {
  prompt: 'werk #51 uit',
  werkmap: '/Users/x/OrkestratorWerk/assistant',
  sessie: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
  extraMappen: ['/Users/x/OrkestratorWerk/factory'],
  budgetUsd: 4,
  model: 'claude-opus-4-6',
};

/** Laat `claude` de opgegeven uitvoer teruggeven, met de opgegeven exitcode. */
function metUitvoer(stdout: string, code = 0): void {
  stelAsyncUitvoerderIn(maakAsyncUitvoerderOpnemer(() => ({ code, stdout })).uitvoerder);
}

describe('werkerArgumenten', () => {
  it('geeft de sessie zelf mee in plaats van hem achteraf op te vissen', () => {
    const args = werkerArgumenten(OPDRACHT);

    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(OPDRACHT.sessie);
  });

  it('begrenst de kosten en dwingt het verdict af', () => {
    const args = werkerArgumenten(OPDRACHT);

    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('4');
    const schema = args[args.indexOf('--json-schema') + 1] ?? '';
    // Een inline JSON-string, geen bestandspad: `--json-schema` accepteert alleen JSON.
    const ontleed = JSON.parse(schema) as Record<string, unknown>;
    // De API eist een top-level `type` en weigert een `$schema`-sleutel; allebei
    // gemeten (HTTP 400 respectievelijk "no schema with key or ref").
    expect(ontleed['type']).toBe('object');
    expect(ontleed).not.toHaveProperty('$schema');
    expect(schema).toContain('escalatie');
  });

  it('geeft de werker geen enkel schrijfrecht', () => {
    const args = werkerArgumenten(OPDRACHT);

    // De toestemmingslijst is de grens. Alleen `Write` en `Edit` verbieden is niet
    // genoeg: het model wijkt dan uit naar `Bash(echo … > bestand)`, en dat deed het
    // in de proefrun ook echt.
    expect(WERKER_TOEGESTAAN).not.toContain('Write');
    expect(WERKER_TOEGESTAAN.some((recht) => recht.startsWith('Bash(gh issue edit'))).toBe(false);
    expect(WERKER_VERBODEN).toContain('Write');
    for (const recht of WERKER_TOEGESTAAN) {
      expect(args).toContain(recht);
    }
    for (const verbod of WERKER_VERBODEN) {
      expect(args).toContain(verbod);
    }
  });

  it('geeft geen enkele werker `gh api` — dat kan via de REST-API muteren (#338)', () => {
    // `gh api` staat op geen enkele toestemmingslijst: het kan met `-X POST` comments
    // plaatsen of labels zetten en omzeilt daarmee de expliciete verbodslijst (waar
    // `gh issue edit`/`gh project` wél op staan). Geen werker heeft het nodig — ze lezen
    // het issue via `gh issue view`, code via Read/Grep en acc via curl. Deze pin houdt
    // het uit alle drie de lijsten, zoals de grenzen voor `rm` en `git -C` dat doen.
    for (const lijst of [WERKER_TOEGESTAAN, BOUWER_TOEGESTAAN, ACCEPTEER_TOEGESTAAN]) {
      expect(lijst).not.toContain('Bash(gh api:*)');
    }
  });

  it('geeft --effort mee als de opdracht een effort heeft, en laat het weg zonder', () => {
    const met = werkerArgumenten({ ...OPDRACHT, effort: 'medium' });
    expect(met[met.indexOf('--effort') + 1]).toBe('medium');

    // Zonder effort geen vlag: dan kiest claude zijn eigen default (#290).
    expect(werkerArgumenten(OPDRACHT)).not.toContain('--effort');
  });

  it('geeft de factory-spiegel mee als extra leesmap', () => {
    const args = werkerArgumenten(OPDRACHT);

    expect(args[args.indexOf('--add-dir') + 1]).toBe('/Users/x/OrkestratorWerk/factory');
  });
});

describe('draaiWerker', () => {
  afterEach(() => {
    herstelAsyncUitvoerder();
  });

  it('leest een geslaagde run uit de envelop', async () => {
    metUitvoer(fixture('claude-run.json'));

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.beurten).toBe(2);
    expect(uitkomst.kosten).toBeCloseTo(0.3197, 3);
    expect(uitkomst.weigeringen).toBe(0);
    // Het verdict komt uit `structured_output`, niet uit het proza in `result`.
    expect(uitkomst.verdict).toMatchObject({ uitkomst: 'klaar', slices: 3 });
    // De body is het product: hij gaat straks één-op-één de issue-body in.
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.body).toContain('# Proefrun');
  });

  it('behandelt een afgekapte run als mislukt en noemt de grens in de reden', async () => {
    // Een hangende werker hield vroeger de hele nacht bezet (#206). Afkappen is
    // mislukken langs het bestaande pad — label, comment, logregel — en geen crash.
    const { uitvoerder, aanroepen } = maakAsyncUitvoerderOpnemer((aanroep) =>
      aanroep.commando === 'claude'
        ? { code: 124, stdout: '', stderr: '', afgekapt: true as const }
        : {},
    );
    stelAsyncUitvoerderIn(uitvoerder);

    const uitkomst = await draaiWerker({ ...OPDRACHT, timeoutMs: 30 * 60_000 });

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toBe('afgekapt na 30 minuten zonder uitkomst');
    // De async uitvoerder stuurt SIGTERM naar de procesgroep (#224); geen breed pkill.
    expect(aanroepen.some((a) => a.commando === 'pkill')).toBe(false);
  });

  it('geeft de tijdsgrens door aan claude en laat hem weg als er geen is', async () => {
    const metGrens = maakAsyncUitvoerderOpnemer(() => ({
      code: 124,
      afgekapt: true as const,
    }));
    stelAsyncUitvoerderIn(metGrens.uitvoerder);
    await draaiWerker({ ...OPDRACHT, timeoutMs: 12_000 });
    expect(metGrens.aanroepen[0]?.timeoutMs).toBe(12_000);

    // Zonder grens (met de hand gestart) blijft de aanroep onbeperkt.
    const zonder = maakAsyncUitvoerderOpnemer(() => ({ code: 1, stdout: '' }));
    stelAsyncUitvoerderIn(zonder.uitvoerder);
    await draaiWerker(OPDRACHT);
    expect(zonder.aanroepen[0]?.timeoutMs).toBeUndefined();
  });

  it('herkent een mislukte run aan de JSON, niet aan de exitcode', async () => {
    // Deze fixture kwam mét exit 1, maar dat is niet waar we op sturen: de
    // geweigerde-rechten-run hieronder kwam mét exit 0 terwijl er niets gebeurde.
    metUitvoer(fixture('claude-run-fout.json'), 0);

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('error_max_budget_usd');
    // Kosten zijn er ook bij een afgebroken run, en die horen in de comment.
    expect(uitkomst.kosten).toBeCloseTo(0.102583, 5);
  });

  it('rekent een run zonder verdict niet als klaar, ook niet bij exit 0', async () => {
    // De echte val: `is_error: false`, `subtype: "success"`, exit 0 — en toch is er
    // niets gebeurd, want elk schrijfrecht werd geweigerd.
    metUitvoer(fixture('claude-run-zonder-verdict.json'), 0);

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.weigeringen).toBeGreaterThan(0);
    expect(uitkomst.fout).toContain('geweigerd');
  });

  it('houdt de werker buiten de werkmap — opgenomen met de echte rechtenlijst', async () => {
    // Deze fixture is een echte run mét `werkerArgumenten()`: de werker kreeg de
    // opdracht een bestand te maken en probeerde het op zes manieren (`>`, `tee`,
    // `cp /dev/stdin`, `python3`, `dd`). Alle zes geweigerd, map bleef leeg.
    metUitvoer(fixture('claude-run-geweigerd.json'), 0);

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.weigeringen).toBe(6);
    // Sinds #290 zegt `geweigerd` wélk commando raakte, niet kaal "Bash" — dat is de
    // data waarmee je de rechtenlijst gericht kunt verbreden. De zes pogingen zijn
    // printf, tee, cp, python3, dd (printf twee keer, dus vijf labels).
    expect([...(uitkomst.geweigerd ?? [])].sort()).toEqual([
      'cp',
      'dd',
      'printf',
      'python3',
      'tee',
    ]);
    expect(uitkomst.geweigerd).not.toContain('Bash');
    // En hij kwam er niet omheen, dus er is geen uitwerking — alleen een vraag.
    expect(uitkomst.afloop).toBe('escalatie');
  });

  it('gooit een geslaagde run niet weg bij een geweigerde niet-Bash-tool (#387)', async () => {
    // Een geweigerde Write/Edit/MCP-tool heeft een `tool_input` zónder `command`;
    // alleen `Bash` draagt een `command`. Het schema eiste `command` verplicht en
    // zette zo'n geslaagde run weg als "envelop wijkt af" (val op #359). De envelop
    // hieronder is de echte klaar-run mét twee weigeringen: één Bash (mét command),
    // één Write (zónder). Beide horen geteld en gelabeld te worden, en de run blijft
    // klaar.
    const basis = JSON.parse(fixture('claude-run.json')) as Record<string, unknown>;
    basis['permission_denials'] = [
      { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      { tool_name: 'Write', tool_input: { file_path: '/Users/x/OrkestratorWerk/assistant/a.ts' } },
    ];
    metUitvoer(JSON.stringify(basis), 0);

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.weigeringen).toBe(2);
    // De Bash-weigering wordt tot `git push` gelabeld, de Write tot kaal `Write`.
    expect([...(uitkomst.geweigerd ?? [])].sort()).toEqual(['Write', 'git push']);
  });

  it('meldt het als de envelop niet meer klopt', async () => {
    metUitvoer(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('envelop');
  });

  it('meldt het als claude helemaal geen JSON teruggeeft', async () => {
    metUitvoer('command not found: claude', 127);

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('geen leesbare JSON');
  });

  it('geeft een escalatie door als escalatie, niet als fout', async () => {
    metUitvoer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: OPDRACHT.sessie,
        num_turns: 9,
        total_cost_usd: 1.2,
        result: 'zie verdict',
        structured_output: { uitkomst: 'escalatie', vraag: 'welk kanaal?', advies: 'Matrix' },
      }),
    );

    const uitkomst = await draaiWerker(OPDRACHT);

    // Escaleren is geen falen: het item krijgt een vraag, geen foutmelding.
    expect(uitkomst.afloop).toBe('escalatie');
    expect(uitkomst.fout).toBeUndefined();
  });

  it('accepteert klaar met een keuzeNotitie', async () => {
    metUitvoer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: OPDRACHT.sessie,
        num_turns: 10,
        total_cost_usd: 1.0,
        result: 'zie verdict',
        structured_output: {
          uitkomst: 'klaar',
          samenvatting: 'Uitgewerkt.',
          slices: 2,
          body: '# Body',
          keuzeNotitie: 'Zod v4 gekozen boven v3 — het project staat er al op.',
        },
      }),
    );

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.keuzeNotitie).toBe(
      'Zod v4 gekozen boven v3 — het project staat er al op.',
    );
  });

  it('accepteert klaar zonder keuzeNotitie', async () => {
    metUitvoer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: OPDRACHT.sessie,
        num_turns: 10,
        total_cost_usd: 1.0,
        result: 'zie verdict',
        structured_output: {
          uitkomst: 'klaar',
          samenvatting: 'Uitgewerkt.',
          slices: 2,
          body: '# Body',
        },
      }),
    );

    const uitkomst = await draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.keuzeNotitie).toBeUndefined();
  });

  it('accepteert een bouw-verdict met keuzeNotitie', async () => {
    metUitvoer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: OPDRACHT.sessie,
        num_turns: 15,
        total_cost_usd: 5.0,
        result: 'zie verdict',
        structured_output: {
          uitkomst: 'klaar',
          samenvatting: 'Gebouwd en getest.',
          criteria: [{ criterium: 'Route geeft 200', bewijs: 'test/e2e:geeft 200' }],
          keuzeNotitie: 'Fastify-plugin in plaats van middleware — past beter bij de app.',
        },
      }),
    );

    const uitkomst = await draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.keuzeNotitie).toBe(
      'Fastify-plugin in plaats van middleware — past beter bij de app.',
    );
  });

  it('accepteert een bouw-verdict zonder keuzeNotitie', async () => {
    metUitvoer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: OPDRACHT.sessie,
        num_turns: 15,
        total_cost_usd: 5.0,
        result: 'zie verdict',
        structured_output: {
          uitkomst: 'klaar',
          samenvatting: 'Gebouwd en getest.',
          criteria: [{ criterium: 'Route geeft 200', bewijs: 'test/e2e:geeft 200' }],
        },
      }),
    );

    const uitkomst = await draaiBouwer(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.keuzeNotitie).toBeUndefined();
  });
});
