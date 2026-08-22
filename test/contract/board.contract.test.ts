/**
 * Contract-tests voor de interpretatie-plekken in board.ts: de jq-expressies, de
 * GraphQL-parse en de git-log-parse. Elke test draait de échte interpretatie tegen
 * een opgenomen respons — zodat een wijziging in de structuur of de expressie
 * meteen zichtbaar wordt, in plaats van pas op productie.
 *
 * De fixtures zijn opgenomen met `scripts/neem-fixtures-op.sh` en worden niet in de
 * poort ververst; dat script is handwerk na een API-wijziging.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  JQ_KINDEREN,
  JQ_OUDER,
  parseKinderenAntwoord,
  parseOuderAntwoord,
  parseOpzoekAntwoord,
  parseIssuesUitLog,
} from '../../src/board.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'contract',
);

function leesFixture(bestand: string): string {
  return readFileSync(path.join(FIXTURES, bestand), 'utf8');
}

/** Draait een jq-expressie tegen een fixture en geeft de ruwe uitvoer terug. */
function draaiJq(expressie: string, fixture: string): string {
  const pad = path.join(FIXTURES, fixture);
  // -r geeft raw output (zonder aanhalingstekens), net als gh api --jq.
  return execSync(`jq -r '${expressie}' '${pad}'`, { encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// alleKinderenDicht: jq + TypeScript-interpretatie
// ---------------------------------------------------------------------------

describe('alleKinderenDicht — jq-expressie tegen opgenomen respons', () => {
  it('leest 1/3 uit een issue met sub_issues_summary = 1 van 3', () => {
    const resultaat = draaiJq(JQ_KINDEREN, 'issue-sub-issues-1-3.json');

    expect(resultaat).toBe('1/3');
  });

  it('leest 3/3 uit een issue met sub_issues_summary = 3 van 3', () => {
    const resultaat = draaiJq(JQ_KINDEREN, 'issue-sub-issues-3-3.json');

    expect(resultaat).toBe('3/3');
  });

  it('parseert 3/3 als alle kinderen dicht', () => {
    expect(parseKinderenAntwoord('3/3')).toBe(true);
  });

  it('parseert 1/3 als niet alle kinderen dicht', () => {
    expect(parseKinderenAntwoord('1/3')).toBe(false);
  });

  it('parseert 0/3 als niet alle kinderen dicht', () => {
    expect(parseKinderenAntwoord('0/3')).toBe(false);
  });

  it('ketent jq-uitvoer en TypeScript-parse: 3/3 → true, 1/3 → false', () => {
    const volledig = draaiJq(JQ_KINDEREN, 'issue-sub-issues-3-3.json');
    const gedeeltelijk = draaiJq(JQ_KINDEREN, 'issue-sub-issues-1-3.json');

    expect(parseKinderenAntwoord(volledig)).toBe(true);
    expect(parseKinderenAntwoord(gedeeltelijk)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ouderVan: jq + TypeScript-interpretatie
// ---------------------------------------------------------------------------

describe('ouderVan — jq-expressie tegen opgenomen respons', () => {
  it('leest de parent_issue_url uit een issue met ouder', () => {
    const resultaat = draaiJq(JQ_OUDER, 'issue-met-ouder.json');

    expect(resultaat).toMatch(/\/issues\/\d+$/);
  });

  it('leest null uit een issue zonder ouder', () => {
    const resultaat = draaiJq(JQ_OUDER, 'issue-zonder-ouder.json');

    // jq -r geeft "null" als het veld niet bestaat; gh api vangt dat af en geeft
    // undefined door, maar de jq-uitvoer zelf is "null" — dat toetsen we hier.
    expect(resultaat).toBe('null');
  });

  it('parseert de URL tot het issuenummer', () => {
    const url = draaiJq(JQ_OUDER, 'issue-met-ouder.json');

    expect(parseOuderAntwoord(url)).toBe(171);
  });

  it('geeft undefined voor een issue zonder ouder', () => {
    // gh api geeft bij een null-veld undefined door aan ouderVan; de parse vangt
    // dat al eerder af. Hier testen we dat de parse ook met willekeurige tekst
    // geen crash geeft.
    expect(parseOuderAntwoord('null')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// zoekDoelwit: GraphQL-parse
// ---------------------------------------------------------------------------

describe('zoekDoelwit — GraphQL-parse tegen opgenomen respons', () => {
  it('leest item-id, veld-id, optie-id en huidige kolom uit een geldige respons', () => {
    const ruw = leesFixture('graphql-opzoek.json');
    const doelwit = parseOpzoekAntwoord(ruw, 'Bouwen');

    expect(doelwit).toBeDefined();
    expect(doelwit?.itemId).toBe('PVTI_lAHOAAGzL84A0abc_186');
    expect(doelwit?.projectId).toBe('PVT_kwHOAAGzL84A0abc');
    expect(doelwit?.veldId).toBe('PVTSSF_lAHOAAGzL84A0abc_def');
    expect(doelwit?.optieId).toBe('opt-bouwen');
    expect(doelwit?.huidig).toBe('Bouwen');
  });

  it('vindt de optie-id voor elke kolom', () => {
    const ruw = leesFixture('graphql-opzoek.json');

    expect(parseOpzoekAntwoord(ruw, 'Uitrollen')?.optieId).toBe('opt-uitrollen');
    expect(parseOpzoekAntwoord(ruw, 'Done')?.optieId).toBe('opt-done');
    expect(parseOpzoekAntwoord(ruw, 'Idee')?.optieId).toBe('opt-idee');
  });

  it('geeft undefined bij een schema-afwijking (ontbrekend field-veld)', () => {
    const ruw = leesFixture('graphql-opzoek-schema-fout.json');
    const doelwit = parseOpzoekAntwoord(ruw, 'Bouwen');

    // Een respons zonder field, options of nodes levert undefined op — geen
    // stille undefined-keten die later een TypeError wordt.
    expect(doelwit).toBeUndefined();
  });

  it('geeft undefined bij ongeldige JSON', () => {
    expect(parseOpzoekAntwoord('geen json', 'Bouwen')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issuesUitBereik: git-log-parse
// ---------------------------------------------------------------------------

describe('issuesUitBereik — git-log-parse tegen opgenomen uitvoer', () => {
  it('haalt de issuenummers uit de slice-merges, ontdubbeld en gesorteerd', () => {
    const log = leesFixture('git-log-merges.txt').trim();
    const nummers = parseIssuesUitLog(log);

    // slice/132-1 en slice/132-2 zijn hetzelfde issue: ontdubbeld tot één keer.
    expect(nummers).toEqual([108, 112, 121, 122, 132]);
  });

  it('laat niet-slice-branches liggen', () => {
    const log = leesFixture('git-log-merges.txt').trim();
    const nummers = parseIssuesUitLog(log);

    // fix/release-via-pr, docs/kolommen-wachtrij2, etc. leveren geen issuenummer op.
    // Er zijn 13 regels maar slechts 6 slice-merges (5 unieke issues).
    expect(nummers).toHaveLength(5);
  });

  it('geeft een lege lijst bij een log zonder slice-merges', () => {
    const log = ['release: v1.15.1', 'Merge pull request #137 from gjvv13/fix/release-via-pr'].join(
      '\n',
    );

    expect(parseIssuesUitLog(log)).toEqual([]);
  });

  it('geeft een lege lijst bij een lege string', () => {
    expect(parseIssuesUitLog('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// issuesUitBereik: trailer-parse (%B-uitvoer met Refs/Closes/Fixes-trailers)
// ---------------------------------------------------------------------------

describe('issuesUitBereik — trailer-parse tegen opgenomen %B-uitvoer', () => {
  it('herkent slice-merges én Refs/Closes/Fixes-trailers, ontdubbeld en gesorteerd', () => {
    const log = leesFixture('git-log-met-trailers.txt').trim();
    const nummers = parseIssuesUitLog(log);

    // slice/182-1 → 182, Refs: #183 → 183 (tweemaal, ontdubbeld), Fixes #200 → 200,
    // Closes: #201 → 201. "#99 midden in een zin" wordt genegeerd.
    expect(nummers).toEqual([182, 183, 200, 201]);
  });

  it('negeert een #N midden in een zin (geen regelbegin)', () => {
    const log = leesFixture('git-log-met-trailers.txt').trim();
    const nummers = parseIssuesUitLog(log);

    expect(nummers).not.toContain(99);
  });

  it('herkent trailers case-insensitief en met of zonder dubbele punt', () => {
    const log = ['Refs: #10', 'closes #20', 'FIXES: #30', 'Refs #40'].join('\n');

    expect(parseIssuesUitLog(log)).toEqual([10, 20, 30, 40]);
  });

  it('de bestaande %s-fixture blijft groen (backward-compatibel)', () => {
    const log = leesFixture('git-log-merges.txt').trim();
    const nummers = parseIssuesUitLog(log);

    expect(nummers).toEqual([108, 112, 121, 122, 132]);
  });
});
