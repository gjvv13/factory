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
        bouwDagmaximum: 2,
        budgetPerRun: 5,
        bouwBudgetPerRun: 10,
        reviewBudgetPerRun: 3,
        runTimeoutMs: 30 * 60_000,
        werkerEffort: 'medium',
      });
    });

    it('leest een eigen dagmaximum en budget', () => {
      schrijfEnv('FACTORY_DAGMAXIMUM=2\nFACTORY_BUDGET_USD=1.5\n');

      expect(leesInstellingen(paden)).toEqual({
        dagmaximum: 2,
        bouwDagmaximum: 2,
        budgetPerRun: 1.5,
        bouwBudgetPerRun: 10,
        reviewBudgetPerRun: 3,
        runTimeoutMs: 30 * 60_000,
        werkerEffort: 'medium',
      });
    });

    it('leest een eigen tijdsgrens per run en rekent naar milliseconden', () => {
      schrijfEnv('FACTORY_RUN_TIMEOUT_MIN=12\n');

      expect(leesInstellingen(paden).runTimeoutMs).toBe(12 * 60_000);
    });

    it('weigert een tijdsgrens die niet onder de slotgeldigheid blijft', () => {
      // Het slot van de orkestrator vervalt na een uur. Een run die langer mag leven dan
      // dat, ziet zijn eigen slot verlopen — en dan start er een tweede orkestrator naast
      // de eerste (#206).
      schrijfEnv('FACTORY_RUN_TIMEOUT_MIN=90\n');

      expect(() => leesInstellingen(paden)).toThrow(/FACTORY_RUN_TIMEOUT_MIN/);
    });

    it('leest een eigen bouw-dagmaximum (#343)', () => {
      schrijfEnv('FACTORY_BOUW_DAGMAXIMUM=5\n');

      const instellingen = leesInstellingen(paden);
      expect(instellingen.bouwDagmaximum).toBe(5);
      // De refine-dagmaximum blijft ongewijzigd.
      expect(instellingen.dagmaximum).toBe(4);
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
        bouwDagmaximum: 2,
        budgetPerRun: 5,
        bouwBudgetPerRun: 10,
        reviewBudgetPerRun: 3,
        runTimeoutMs: 30 * 60_000,
        werkerEffort: 'medium',
      });
    });

    it('leest een eigen werker-effort en valt anders terug op medium (#290)', () => {
      schrijfEnv('FACTORY_WERKER_EFFORT=low\n');
      expect(leesInstellingen(paden).werkerEffort).toBe('low');
    });

    it('weigert een onbekende effort-waarde luid', () => {
      schrijfEnv('FACTORY_WERKER_EFFORT=turbo\n');
      expect(() => leesInstellingen(paden)).toThrow(/FACTORY_WERKER_EFFORT/);
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
      // Het skelet noemt het bouw-dagmaximum zodat je weet dat de knop bestaat (#343).
      expect(readFileSync(paden.envPad, 'utf8')).toContain('FACTORY_BOUW_DAGMAXIMUM');

      writeFileSync(paden.envPad, `${TOKEN_SLEUTEL}=sk-blijft-staan\n`, { mode: 0o600 });
      zorgVoorEnvBestand(paden);

      // Idempotent, en zonder de token van iemand te overschrijven.
      expect(readFileSync(paden.envPad, 'utf8')).toContain('sk-blijft-staan');
    });
  });

  describe('de echte home is voor tests verboden (#278)', () => {
    it('gooit als standaardPaden tijdens een test naar de echte home wijst', () => {
      // `test/setup.ts` zet een tijdelijke home; dit is het vangnet als die opzet stuk
      // is. Zonder dat vangnet schreef de suite 369 regels in het runlog van de
      // gebruiker en zette de dagteller op 93 van 4.
      const echte = process.env['FACTORY_ECHTE_HOME'];
      expect(echte).toBeDefined();
      expect(() => standaardPaden(echte)).toThrow(/echte home/);
    });

    it('laat een tijdelijke home gewoon door', () => {
      expect(standaardPaden('/var/tmp/wat-dan-ook').logPad).toContain('/var/tmp/wat-dan-ook');
    });
  });

  describe('de dagteller', () => {
    it('telt runs op dezelfde kalenderdag bij elkaar op', () => {
      const nu = new Date('2026-08-19T22:10:00');

      expect(boekRun(paden, nu, 'nacht')).toBe(1);
      expect(boekRun(paden, nu, 'nacht')).toBe(2);
      expect(leesStaat(paden, nu).gestart).toBe(2);
    });

    it('leest een opgenomen stand terug', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      copyFileSync(fixture('orkestrator-status.json'), paden.staatPad);

      // Dezelfde dag als in de fixture: de drie runs van vannacht tellen mee, dus een
      // vierde run is de laatste bij dagmaximum 4.
      expect(leesStaat(paden, new Date('2026-08-19T23:00:00')).gestart).toBe(3);
      expect(boekRun(paden, new Date('2026-08-19T23:00:00'), 'nacht')).toBe(4);
    });

    it('houdt de nachtpot en wat je zelf start apart (#264)', () => {
      const nu = new Date('2026-08-21T15:00:00');

      // Een middag experimenteren mag de nacht niet leegtrekken: de nacht stopt op zijn
      // eigen teller, en wat jij start heeft geen maximum — dat aantal geef je mee bij
      // het starten.
      expect(boekRun(paden, nu, 'interactief')).toBe(1);
      expect(boekRun(paden, nu, 'interactief')).toBe(2);
      expect(boekRun(paden, nu, 'nacht')).toBe(1);

      const staat = leesStaat(paden, nu);
      expect(staat.gestart).toBe(1);
      expect(staat.interactief).toBe(2);
    });

    it('houdt de bouw-nacht-teller apart van de refine-nacht-teller (#343)', () => {
      const nu = new Date('2026-08-24T05:30:00');

      // Drie potten, drie tellers: een bouw-nacht-run verhoogt nachtBouw, niet gestart.
      expect(boekRun(paden, nu, 'nacht')).toBe(1);
      expect(boekRun(paden, nu, 'nacht')).toBe(2);
      expect(boekRun(paden, nu, 'nacht-bouw')).toBe(1);
      expect(boekRun(paden, nu, 'nacht-bouw')).toBe(2);
      expect(boekRun(paden, nu, 'interactief')).toBe(1);

      const staat = leesStaat(paden, nu);
      expect(staat.gestart).toBe(2);
      expect(staat.nachtBouw).toBe(2);
      expect(staat.interactief).toBe(1);
    });

    it('leest een staatbestand zonder nachtBouw zonder klagen (#343)', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      copyFileSync(fixture('orkestrator-status.json'), paden.staatPad);

      // De fixture is van vóór #343 en heeft geen `nachtBouw`; dat defaultt naar 0
      // zonder waarschuwing en zonder de andere tellers te resetten.
      const staat = leesStaat(paden, new Date('2026-08-19T23:00:00'));
      expect(staat.gestart).toBe(3);
      expect(staat.nachtBouw).toBe(0);
      expect(staat.interactief).toBe(0);
    });

    it('leest een staatbestand van vóór de splitsing zonder klagen', () => {
      mkdirSync(path.dirname(paden.staatPad), { recursive: true });
      copyFileSync(fixture('orkestrator-status.json'), paden.staatPad);

      // De fixture is van vóór #264 en heeft geen `interactief`; dat mag geen
      // waarschuwing en geen reset van de nachtteller opleveren.
      const staat = leesStaat(paden, new Date('2026-08-19T23:00:00'));
      expect(staat.gestart).toBe(3);
      expect(staat.interactief).toBe(0);
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
        soort: 'refine',
        app: 'factory',
        uitkomst: 'klaar',
        kosten: 0.42,
        beurten: 9,
      });
      logRun(paden, nu, { issue: 51, app: 'assistant', soort: 'bouw', uitkomst: 'escalatie' });

      const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
      expect(regels[0]).toMatch(/#131 factory refine klaar \$0\.42 9 beurten/);
      // Onbekende kosten worden een `?` en niet stil $0,00 — dat laatste liegt.
      expect(regels[1]).toMatch(/#51 assistant bouw escalatie \? \? beurten/);
    });

    it('schrijft de uitsplitsing achter de beurten als hij er is (#298)', () => {
      logRun(paden, new Date('2026-08-22T04:12:03Z'), {
        issue: 131,
        soort: 'bouw',
        app: 'factory',
        uitkomst: 'klaar',
        kosten: 3.21,
        beurten: 60,
        uitsplitsing: '(bouw $2.09 · review $1.12)',
      });

      const regel = readFileSync(paden.logPad, 'utf8').trim();
      expect(regel).toMatch(
        /#131 factory bouw klaar \$3\.21 60 beurten \(bouw \$2\.09 · review \$1\.12\)/,
      );
    });

    it('schrijft dezelfde regel als voorheen zonder uitsplitsing (#298)', () => {
      logRun(paden, new Date('2026-08-22T04:12:03Z'), {
        issue: 131,
        soort: 'bouw',
        app: 'factory',
        uitkomst: 'escalatie',
        kosten: 2.09,
        beurten: 37,
      });

      const regel = readFileSync(paden.logPad, 'utf8').trim();
      expect(regel).toMatch(/#131 factory bouw escalatie \$2\.09 37 beurten$/);
    });
  });
});
