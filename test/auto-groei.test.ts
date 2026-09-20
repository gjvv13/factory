import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verwerkAutoGroei } from '../src/commands/orkestreer-bouw.js';
import { leesAgentGrenzen } from '../src/agent-definitie.js';
import { standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
import { leesTellers } from '../src/wrijving-tellers.js';

/**
 * Integratietest voor de auto-groei flow (#543): van weigeringslabels tot agent-
 * definitie-update. Git/gh en notificatie worden overgeslagen (skipGit, skipNotify).
 *
 * De edit landt in de factory-SPIEGEL (`<spiegel>/agents/<agent>.md`) — dezelfde locatie
 * waar `maakAutoGroeiPr` de commit maakt (#752). De test gebruikt een echte spiegel-map
 * met een wegwerp-agent, en leest de uitkomst uit díé map, zodat edit- en commit-locatie
 * aantoonbaar samenvallen (de oude flow editte de pakketmap en committe in de spiegel →
 * de PR landde nooit).
 */
describe('verwerkAutoGroei', () => {
  let tmpDir: string;
  let spiegelDir: string;
  let spiegelAgents: string;
  let paden: OrkestratorPaden;
  const testAgent = 'test-auto-groei-flow';

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'auto-groei-test-'));
    paden = standaardPaden(tmpDir);

    // Een echte factory-spiegel met een wegwerp-agent met een schone allowlist.
    spiegelDir = path.join(tmpDir, 'factory-spiegel');
    spiegelAgents = path.join(spiegelDir, 'agents');
    mkdirSync(spiegelAgents, { recursive: true });
    writeFileSync(
      path.join(spiegelAgents, `${testAgent}.md`),
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
  });

  it('werkt tellers bij en voegt een veilig patroon toe in de spiegel na 3 weigeringen', () => {
    // Schrijf de teller op drempel-1 voor 'diff'.
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    writeFileSync(paden.tellersPad, JSON.stringify({ diff: 2 }));

    const groei = verwerkAutoGroei(['diff'], paden, spiegelDir, {
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

    // Het patroon staat nu in de agent-definitie IN DE SPIEGEL (waar de commit hem pakt).
    const grenzen = leesAgentGrenzen(testAgent, spiegelAgents);
    expect(grenzen.allowedTools).toContain('Bash(diff:*)');
  });

  it('slaat een tool buiten de veilige klasse over zonder fout', () => {
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    // 'rm' bereikt de drempel maar is niet veilig.
    writeFileSync(paden.tellersPad, JSON.stringify({ rm: 2 }));

    const groei = verwerkAutoGroei(['rm'], paden, spiegelDir, {
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
    const groei = verwerkAutoGroei([], paden, spiegelDir, {
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
    const groei1 = verwerkAutoGroei(['diff'], paden, spiegelDir, opts);
    expect(groei1).toHaveLength(0);

    // Run 2.
    const groei2 = verwerkAutoGroei(['diff'], paden, spiegelDir, opts);
    expect(groei2).toHaveLength(0);

    // Run 3: drempel bereikt.
    const groei3 = verwerkAutoGroei(['diff'], paden, spiegelDir, opts);
    expect(groei3).toHaveLength(1);
    expect(groei3[0]?.label).toBe('diff');

    // Run 4: geen herhaling.
    const groei4 = verwerkAutoGroei(['diff'], paden, spiegelDir, opts);
    expect(groei4).toHaveLength(0);
  });

  it('voegt een patroon niet dubbel toe aan de allowlist', () => {
    mkdirSync(path.dirname(paden.tellersPad), { recursive: true });
    // De agent heeft 'Bash(diff:*)' al — simuleer dat door het alvast in de spiegel te zetten.
    const agentPad = path.join(spiegelAgents, `${testAgent}.md`);
    const inhoud = readFileSync(agentPad, 'utf8');
    writeFileSync(agentPad, inhoud.replace('  - Read', "  - Read\n  - 'Bash(diff:*)'"));

    // Teller op drempel-1.
    writeFileSync(paden.tellersPad, JSON.stringify({ diff: 2 }));

    const groei = verwerkAutoGroei(['diff'], paden, spiegelDir, {
      skipGit: true,
      skipNotify: true,
      agent: testAgent,
    });

    // De groei wordt gemeld (de teller overschreed de drempel), maar het patroon
    // was al aanwezig — voegToolToe is een no-op.
    expect(groei).toHaveLength(1);
    const grenzen = leesAgentGrenzen(testAgent, spiegelAgents);
    const aantal = grenzen.allowedTools.filter((t) => t === 'Bash(diff:*)').length;
    expect(aantal).toBe(1);
  });
});
