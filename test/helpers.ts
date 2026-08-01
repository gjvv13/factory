import type { ProcesUitkomst, RunOptions, Uitvoerder } from '../src/shell.js';

/** Eén opgenomen proces-aanroep: genoeg om te controleren wat een commando zou draaien. */
export interface ProcesAanroep {
  readonly commando: string;
  readonly argumenten: string[];
  readonly cwd?: string;
}

export interface Opnemer {
  readonly uitvoerder: Uitvoerder;
  readonly aanroepen: ProcesAanroep[];
}

/**
 * Bepaalt de uitkomst van één opgenomen aanroep. Wat niet wordt teruggegeven valt
 * terug op slagen (code 0, lege uitvoer). Zo kan een test bijvoorbeeld de branch
 * `main` teruggeven of één specifiek commando laten falen.
 */
export type UitkomstBepaler = (aanroep: ProcesAanroep, index: number) => Partial<ProcesUitkomst>;

/**
 * Een proces-uitvoerder die niets uitvoert maar elke aanroep onthoudt. Zo kan een
 * test controleren welke externe commando's (git, pnpm, pm2) een functie zou
 * draaien, zonder de buitenwereld aan te raken. Standaard slaagt elke aanroep;
 * geef een bepaler mee om per aanroep een uitvoer of een fout te sturen.
 */
export function maakUitvoerderOpnemer(bepaal?: UitkomstBepaler): Opnemer {
  const aanroepen: ProcesAanroep[] = [];
  const uitvoerder: Uitvoerder = (commando, argumenten, options: RunOptions) => {
    const aanroep: ProcesAanroep = {
      commando,
      argumenten,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    };
    aanroepen.push(aanroep);
    return { code: 0, stdout: '', ...(bepaal?.(aanroep, aanroepen.length - 1) ?? {}) };
  };
  return { uitvoerder, aanroepen };
}
