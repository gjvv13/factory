import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verwerkAutoGroei } from '../src/commands/orkestreer-bouw.js';
import { leesAgentGrenzen } from '../src/agent-definitie.js';
import { standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
import { agentsDir } from '../src/paths.js';
import { leesTellers } from '../src/wrijving-tellers.js';

/**
 * Integratietest voor de auto-groei flow (#543): van weigeringslabels tot agent-
 * definitie-update. Git/gh en notificatie worden overgeslagen (skipGit, skipNotify).
 *
 * De tests gebruiken een wegwerp-agent (`test-auto-groei-flow.md`) zodat het echte
 * `bouwer.md` niet als neveneffect verandert.
 */
describe('verwerkAutoGroei', () => {
  let tmpDir: string;
  let paden: OrkestratorPaden;
  const testAgent = 'test-auto-groei-flow';
  const testAgentPad = path.join(agentsDir, `${testAgent}.md`);

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'auto-groei-test-'));
    paden = standaardPaden(tmpDir);

    // Maak een test-agent met een schone allowlist.
    writeFileSync(
      testAgentPad,
      [
        '---',
        `name: ${testAgent}`,
        'allowedTools:',
        '  - Read',
        'disallowedTools:',
        '  - Write',
        '---',
        '',
        'Test.',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(testAgentPad, { force: true });
  });

  it('werkt tellers bij en voegt een veilig patroon toe na 3 weigeringen', () => {
    // Schrijf de teller op drempel-1 voor 'diff'.
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    writeFileSync(paden.tellersPad, JSON.stringify({ diff: 2 }));

    const groei = verwerkAutoGroei(['diff'], paden, '/fake/factory', {
      skipGit: true,
      skipNotify: true,
      agent: testAgent,
    });

    expect(groei).toHaveLength(1);
    expect(groei[0]?.label).toBe('diff');
    expect(groei[0]?.patroon).toBe('Bash(diff:*)');

    // De teller is opgehoogd.
    const tellers = leesTellers(paden.tellersPad);
    expect(tellers['diff']).toBe(3);

    // Het patroon staat nu in de agent-definitie.
    const grenzen = leesAgentGrenzen(testAgent);
    expect(grenzen.allowedTools).toContain('Bash(diff:*)');
  });

  it('slaat een tool buiten de veilige klasse over zonder fout', () => {
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    // 'rm' bereikt de drempel maar is niet veilig.
    writeFileSync(paden.tellersPad, JSON.stringify({ rm: 2 }));

    const groei = verwerkAutoGroei(['rm'], paden, '/fake/factory', {
      skipGit: true,
      skipNotify: true,
      agent: testAgent,
    });

    // Geen groei: rm is niet in de veilige klasse.
    expect(groei).toHaveLength(0);
    // De teller is wél opgehoogd (voor handmatig inzicht, #544).
    const tellers = leesTellers(paden.tellersPad);
    expect(tellers['rm']).toBe(3);
  });

  it('doet niets bij een lege geweigerd-lijst', () => {
    const groei = verwerkAutoGroei([], paden, '/fake/factory', {
      skipGit: true,
      skipNotify: true,
      agent: testAgent,
    });

    expect(groei).toHaveLength(0);
  });

  it('bereikt de drempel pas na 3 runs met dezelfde weigering', () => {
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });

    const opts = { skipGit: true, skipNotify: true, agent: testAgent } as const;

    // Run 1: diff verschijnt voor het eerst.
    const groei1 = verwerkAutoGroei(['diff'], paden, '/fake/factory', opts);
    expect(groei1).toHaveLength(0);

    // Run 2.
    const groei2 = verwerkAutoGroei(['diff'], paden, '/fake/factory', opts);
    expect(groei2).toHaveLength(0);

    // Run 3: drempel bereikt.
    const groei3 = verwerkAutoGroei(['diff'], paden, '/fake/factory', opts);
    expect(groei3).toHaveLength(1);
    expect(groei3[0]?.label).toBe('diff');

    // Run 4: geen herhaling.
    const groei4 = verwerkAutoGroei(['diff'], paden, '/fake/factory', opts);
    expect(groei4).toHaveLength(0);
  });

  it('voegt een patroon niet dubbel toe aan de allowlist', () => {
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    // De agent heeft 'Bash(diff:*)' al na de vorige test of een handmatige toevoeging.
    // Simuleer dat door het patroon alvast toe te voegen.
    const inhoud = readFileSync(testAgentPad, 'utf8');
    writeFileSync(testAgentPad, inhoud.replace('  - Read', "  - Read\n  - 'Bash(diff:*)'"));

    // Teller op drempel-1.
    writeFileSync(paden.tellersPad, JSON.stringify({ diff: 2 }));

    const groei = verwerkAutoGroei(['diff'], paden, '/fake/factory', {
      skipGit: true,
      skipNotify: true,
      agent: testAgent,
    });

    // De groei wordt gemeld (de teller overschreed de drempel), maar het patroon
    // was al aanwezig — voegToolToe is een no-op.
    expect(groei).toHaveLength(1);
    const grenzen = leesAgentGrenzen(testAgent);
    const aantal = grenzen.allowedTools.filter((t) => t === 'Bash(diff:*)').length;
    expect(aantal).toBe(1);
  });
});
