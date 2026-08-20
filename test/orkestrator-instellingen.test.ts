import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boekRun,
  kalenderdag,
  leesInstellingen,
  leesStaat,
  logRun,
  standaardPaden,
  TOKEN_SLEUTEL,
  vereisToken,
  zorgVoorEnvBestand,
  type OrkestratorPaden,
} from '../src/orkestrator-instellingen.js';
import { mkdtempSync } from 'node:fs';

/** De opgenomen staat van een nacht die al drie runs had (`test/fixtures`). */
function fixture(naam: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', naam);
}

describe('orkestrator-instellingen', () => {
  let home: string;
  let paden: OrkestratorPaden;
  let uitvoer: string[];

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-ork-home-'));
    paden = standaardPaden(home);
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function schrijfEnv(inhoud: string, modus = 0o600): void {
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(paden.envPad, inhoud, { mode: modus });
    chmodSync(paden.envPad, modus);
  }

  describe('de rem', () => {
    it('valt zonder bestand terug op dagmaximum 4 en $5 per run', () => {
      // De defaults uit #104/#155. Zonder deze terugval zou een verse machine niets doen
      // of, erger, zonder rem draaien.
      expect(leesInstellingen(paden)).toEqual({
        dagmaximum: 4,
        budgetPerRun: 5,
        bouwBudgetPerRun: 10,
      });
    });

    it('leest een eigen dagmaximum en budget', () => {
      schrijfEnv('FACTORY_DAGMAXIMUM=2\nFACTORY_BUDGET_USD=1.5\n');

      expect(leesInstellingen(paden)).toEqual({
        dagmaximum: 2,
        budgetPerRun: 1.5,
        bouwBudgetPerRun: 10,
      });
    });

    it('heeft een ruimer budget voor een bouw-run dan voor een refinement', () => {
      // Bouwen is lezen, schrijven, de poort draaien en op rood opnieuw — meer beurten
      // dan een refinement. Eén rem voor beide zou of te krap of te ruim zijn.
      schrijfEnv('FACTORY_BOUW_BUDGET_USD=12\n');

      const instellingen = leesInstellingen(paden);
      expect(instellingen.bouwBudgetPerRun).toBe(12);
      expect(instellingen.budgetPerRun).toBe(5);
    });

    it('behandelt een leeg rechterlid als niet-ingevuld', () => {
      // Dit is precies het skelet dat `--installeer` neerzet; zonder deze regel zou
      // `FACTORY_DAGMAXIMUM=` als 0 langs Zod komen en de nacht stilzetten.
      schrijfEnv(`${TOKEN_SLEUTEL}=\nFACTORY_DAGMAXIMUM=\n`);

      expect(leesInstellingen(paden)).toEqual({
        dagmaximum: 4,
        budgetPerRun: 5,
        bouwBudgetPerRun: 10,
      });
    });

    it('faalt luid op een onmogelijke waarde', () => {
      schrijfEnv('FACTORY_DAGMAXIMUM=0\n');

      // Stil corrigeren zou betekenen dat de rem iets anders is dan wat er staat, en
      // die rem is de reden dat onbemand werken mag.
      expect(() => leesInstellingen(paden)).toThrow(/ongeldig/);
    });

    it('waarschuwt als het tokenbestand breder leesbaar is dan 0600', () => {
      schrijfEnv(`${TOKEN_SLEUTEL}=sk-test\n`, 0o644);

      leesInstellingen(paden);

      expect(uitvoer.join('')).toMatch(/rechten 644.*chmod 600/s);
    });
  });

  describe('de token', () => {
    it('zegt wat te doen als hij ontbreekt', () => {
      schrijfEnv('FACTORY_DAGMAXIMUM=4\n');
      const instellingen = leesInstellingen(paden);

      // Een `claude` zonder token vraagt om een login en doet daarna in stilte niets;
      // de fout hoort dus vóór de eerste run te vallen, mét het recept.
      expect(() => vereisToken(instellingen, paden)).toThrow(/claude setup-token/);
      expect(() => vereisToken(instellingen, paden)).toThrow(/chmod 600/);
    });

    it('komt uit het bestand als hij er staat', () => {
      schrijfEnv(`${TOKEN_SLEUTEL}=sk-ant-test\n`);

      expect(vereisToken(leesInstellingen(paden), paden)).toBe('sk-ant-test');
    });

    it('zet een skelet met 0600 neer en raakt een bestaand bestand niet aan', () => {
      zorgVoorEnvBestand(paden);
      expect(statSync(paden.envPad).mode & 0o777).toBe(0o600);
      expect(readFileSync(paden.envPad, 'utf8')).toContain(TOKEN_SLEUTEL);

      writeFileSync(paden.envPad, `${TOKEN_SLEUTEL}=sk-blijft-staan\n`, { mode: 0o600 });
      zorgVoorEnvBestand(paden);

      // Idempotent, en zonder de token van iemand te overschrijven.
      expect(readFileSync(paden.envPad, 'utf8')).toContain('sk-blijft-staan');
    });
  });

  describe('de dagteller', () => {
    it('telt runs op dezelfde kalenderdag bij elkaar op', () => {
      const nu = new Date('2026-08-19T22:10:00');

      expect(boekRun(paden, nu)).toBe(1);
      expect(boekRun(paden, nu)).toBe(2);
      expect(leesStaat(paden, nu).gestart).toBe(2);
    });

    it('leest een opgenomen stand terug', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      copyFileSync(fixture('orkestrator-status.json'), paden.staatPad);

      // Dezelfde dag als in de fixture: de drie runs van vannacht tellen mee, dus een
      // vierde run is de laatste bij dagmaximum 4.
      expect(leesStaat(paden, new Date('2026-08-19T23:00:00')).gestart).toBe(3);
      expect(boekRun(paden, new Date('2026-08-19T23:00:00'))).toBe(4);
    });

    it('begint bij een nieuwe kalenderdag opnieuw', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      copyFileSync(fixture('orkestrator-status.json'), paden.staatPad);

      // Zonder deze reset zou de teller na één volle nacht nooit meer nul worden.
      expect(leesStaat(paden, new Date('2026-08-20T04:00:00')).gestart).toBe(0);
    });

    it('rekent in lokale tijd, niet in UTC', () => {
      // Een run om 01:00 hier valt in UTC op de vorige dag; het dagmaximum is een
      // afspraak over nachten zoals ik ze beleef.
      expect(kalenderdag(new Date('2026-08-20T01:00:00'))).toBe('2026-08-20');
    });

    it('begint opnieuw bij een kapot staatsbestand, met een melding', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      writeFileSync(paden.staatPad, '{ dit is geen json');

      // Het ergste gevolg is één nacht extra runs (#104); nooit meer draaien is erger.
      expect(leesStaat(paden, new Date('2026-08-19T22:00:00')).gestart).toBe(0);
      expect(uitvoer.join('')).toMatch(/niet te lezen/);
    });
  });

  describe('het runlog', () => {
    it('schrijft issue, uitkomst, kosten en beurten per run', () => {
      const nu = new Date('2026-08-19T04:12:03Z');
      logRun(paden, nu, {
        issue: 131,
        app: 'factory',
        uitkomst: 'klaar',
        kosten: 0.42,
        beurten: 9,
      });
      logRun(paden, nu, { issue: 51, app: 'assistant', uitkomst: 'escalatie' });

      const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
      expect(regels[0]).toMatch(/#131 factory klaar \$0\.42 9 beurten/);
      // Onbekende kosten worden een `?` en niet stil $0,00 — dat laatste liegt.
      expect(regels[1]).toMatch(/#51 assistant escalatie \? \? beurten/);
    });
  });
});
