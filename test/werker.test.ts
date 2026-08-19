import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  draaiWerker,
  werkerArgumenten,
  WERKER_TOEGESTAAN,
  WERKER_VERBODEN,
  type WerkerOpdracht,
} from '../src/werker.js';
import { maakUitvoerderOpnemer } from './helpers.js';

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
  stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code, stdout })).uitvoerder);
}

describe('werkerArgumenten', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

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

  it('geeft de factory-spiegel mee als extra leesmap', () => {
    const args = werkerArgumenten(OPDRACHT);

    expect(args[args.indexOf('--add-dir') + 1]).toBe('/Users/x/OrkestratorWerk/factory');
  });
});

describe('draaiWerker', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('leest een geslaagde run uit de envelop', () => {
    metUitvoer(fixture('claude-run.json'));

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('klaar');
    expect(uitkomst.beurten).toBe(2);
    expect(uitkomst.kosten).toBeCloseTo(0.3197, 3);
    expect(uitkomst.weigeringen).toBe(0);
    // Het verdict komt uit `structured_output`, niet uit het proza in `result`.
    expect(uitkomst.verdict).toMatchObject({ uitkomst: 'klaar', slices: 3 });
    // De body is het product: hij gaat straks één-op-één de issue-body in.
    expect(uitkomst.verdict?.uitkomst === 'klaar' && uitkomst.verdict.body).toContain('# Proefrun');
  });

  it('herkent een mislukte run aan de JSON, niet aan de exitcode', () => {
    // Deze fixture kwam mét exit 1, maar dat is niet waar we op sturen: de
    // geweigerde-rechten-run hieronder kwam mét exit 0 terwijl er niets gebeurde.
    metUitvoer(fixture('claude-run-fout.json'), 0);

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('error_max_budget_usd');
    // Kosten zijn er ook bij een afgebroken run, en die horen in de comment.
    expect(uitkomst.kosten).toBeCloseTo(0.102583, 5);
  });

  it('rekent een run zonder verdict niet als klaar, ook niet bij exit 0', () => {
    // De echte val: `is_error: false`, `subtype: "success"`, exit 0 — en toch is er
    // niets gebeurd, want elk schrijfrecht werd geweigerd.
    metUitvoer(fixture('claude-run-zonder-verdict.json'), 0);

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.weigeringen).toBeGreaterThan(0);
    expect(uitkomst.fout).toContain('geweigerd');
  });

  it('houdt de werker buiten de werkmap — opgenomen met de echte rechtenlijst', () => {
    // Deze fixture is een echte run mét `werkerArgumenten()`: de werker kreeg de
    // opdracht een bestand te maken en probeerde het op zes manieren (`>`, `tee`,
    // `cp /dev/stdin`, `python3`, `dd`). Alle zes geweigerd, map bleef leeg.
    metUitvoer(fixture('claude-run-geweigerd.json'), 0);

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.weigeringen).toBe(6);
    // En hij kwam er niet omheen, dus er is geen uitwerking — alleen een vraag.
    expect(uitkomst.afloop).toBe('escalatie');
  });

  it('meldt het als de envelop niet meer klopt', () => {
    metUitvoer(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('envelop');
  });

  it('meldt het als claude helemaal geen JSON teruggeeft', () => {
    metUitvoer('command not found: claude', 127);

    const uitkomst = draaiWerker(OPDRACHT);

    expect(uitkomst.afloop).toBe('mislukt');
    expect(uitkomst.fout).toContain('geen leesbare JSON');
  });

  it('geeft een escalatie door als escalatie, niet als fout', () => {
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

    const uitkomst = draaiWerker(OPDRACHT);

    // Escaleren is geen falen: het item krijgt een vraag, geen foutmelding.
    expect(uitkomst.afloop).toBe('escalatie');
    expect(uitkomst.fout).toBeUndefined();
  });
});
