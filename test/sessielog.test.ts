import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leesWeigeringenUitLog } from '../src/sessielog.js';

/**
 * Het sessielog is een intern Claude Code formaat (#542). Deze tests pinnen de parser
 * vast tegen een opgenomen fixture én tegen de bekende faalscenario's, zodat een
 * formaat-wijziging een contractbreuk signaleert in plaats van een stille terugval.
 */

describe('leesWeigeringenUitLog', () => {
  let tmpDir: string;
  let projectsDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sessielog-test-'));
    projectsDir = path.join(tmpDir, '.claude', 'projects');
    mkdirSync(projectsDir, { recursive: true });

    // Redirect homedir naar tmp zodat de parser daar zoekt.
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (origHome !== undefined) {
      process.env.HOME = origHome;
    } else {
      delete process.env.HOME;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function plaatsLog(sessieId: string, werkmap: string, inhoud: string): void {
    const geencodeerd = werkmap.replaceAll(path.sep, '-');
    const projectMap = path.join(projectsDir, geencodeerd);
    mkdirSync(projectMap, { recursive: true });
    writeFileSync(path.join(projectMap, `${sessieId}.jsonl`), inhoud, 'utf8');
  }

  it('extraheert weigeringen uit een opgenomen fixture', () => {
    const hier = path.dirname(fileURLToPath(import.meta.url));
    const fixture = readFileSync(
      path.join(hier, 'fixtures', 'contract', 'sessielog-met-weigeringen.jsonl'),
      'utf8',
    );
    plaatsLog('test-sessie-123', '/w/factory-wt/91', fixture);

    const resultaat = leesWeigeringenUitLog('test-sessie-123', '/w/factory-wt/91');

    // Drie weigeringen: 2× Bash (push + rm), 1× Write. Gegroepeerd per tool.
    expect(resultaat).toHaveLength(2);

    const bash = resultaat.find((w) => w.tool === 'Bash');
    expect(bash).toBeDefined();
    expect(bash?.aantal).toBe(2);

    const write = resultaat.find((w) => w.tool === 'Write');
    expect(write).toBeDefined();
    expect(write?.aantal).toBe(1);
  });

  it('geeft een leeg resultaat als het bestand niet bestaat', () => {
    const resultaat = leesWeigeringenUitLog('niet-bestaand', '/nep/pad');

    expect(resultaat).toEqual([]);
  });

  it('geeft een leeg resultaat bij een leeg JSONL-bestand', () => {
    plaatsLog('lege-sessie', '/w/factory-wt/91', '');

    const resultaat = leesWeigeringenUitLog('lege-sessie', '/w/factory-wt/91');

    expect(resultaat).toEqual([]);
  });

  it('geeft een leeg resultaat bij onherkenbaar formaat', () => {
    plaatsLog('raar-formaat', '/w/factory-wt/91', '{"type":"iets-onbekends","foo":"bar"}\n');

    const resultaat = leesWeigeringenUitLog('raar-formaat', '/w/factory-wt/91');

    expect(resultaat).toEqual([]);
  });

  it('overleeft een JSONL-regel die geen geldige JSON is', () => {
    const inhoud = [
      'dit is geen json',
      '{"type":"user","toolDenialKind":"permission-rule","toolUseResult":"Error: Permission to use Bash has been denied.","message":{"content":[{"type":"tool_result","content":"Permission to use Bash has been denied.","is_error":true,"tool_use_id":"toolu_01"}]}}',
    ].join('\n');
    plaatsLog('kapotte-json', '/w/factory-wt/91', inhoud);

    const resultaat = leesWeigeringenUitLog('kapotte-json', '/w/factory-wt/91');

    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.tool).toBe('Bash');
    expect(resultaat[0]?.aantal).toBe(1);
  });

  it('geeft een leeg resultaat als er geen weigeringen in het log staan', () => {
    const inhoud = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hallo"}]}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"Bouw dit"}]}}',
    ].join('\n');
    plaatsLog('schoon', '/w/factory-wt/91', inhoud);

    const resultaat = leesWeigeringenUitLog('schoon', '/w/factory-wt/91');

    expect(resultaat).toEqual([]);
  });

  it('sorteert op aantal, meest geweigerd eerst', () => {
    const bashWeigering =
      '{"type":"user","toolDenialKind":"permission-rule","toolUseResult":"Error: Permission to use Bash has been denied.","message":{"content":[{"type":"tool_result","content":"Permission to use Bash has been denied.","is_error":true,"tool_use_id":"toolu_01"}]}}';
    const writeWeigering =
      '{"type":"user","toolDenialKind":"user-rejected","toolUseResult":"Error: Permission to use Write has been denied.","message":{"content":[{"type":"tool_result","content":"Permission to use Write has been denied.","is_error":true,"tool_use_id":"toolu_02"}]}}';
    const inhoud = [bashWeigering, bashWeigering, bashWeigering, writeWeigering].join('\n');
    plaatsLog('gesorteerd', '/w/factory-wt/91', inhoud);

    const resultaat = leesWeigeringenUitLog('gesorteerd', '/w/factory-wt/91');

    expect(resultaat[0]?.tool).toBe('Bash');
    expect(resultaat[0]?.aantal).toBe(3);
    expect(resultaat[1]?.tool).toBe('Write');
    expect(resultaat[1]?.aantal).toBe(1);
  });
});
