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
 * Een proces-uitvoerder die niets uitvoert maar elke aanroep onthoudt. Zo kan een
 * test controleren welke externe commando's (git, pnpm, pm2) een functie zou
 * draaien, zonder de buitenwereld aan te raken. Standaard slaagt elke aanroep;
 * geef een eigen uitkomst mee om een fout te simuleren.
 */
export function maakUitvoerderOpnemer(uitkomst: Partial<ProcesUitkomst> = {}): Opnemer {
  const aanroepen: ProcesAanroep[] = [];
  const uitvoerder: Uitvoerder = (commando, argumenten, options: RunOptions) => {
    aanroepen.push({
      commando,
      argumenten,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    return { code: 0, stdout: '', ...uitkomst };
  };
  return { uitvoerder, aanroepen };
}
