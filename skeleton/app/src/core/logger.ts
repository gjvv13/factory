import { pino } from 'pino';
import type { LogBuffer } from './log-buffer.js';

/** De pino-logniveaus, van meest naar minst spraakzaam. Gedeeld met de config-validatie. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
  child(bindings: Record<string, unknown>): Logger;
  /**
   * Het actieve logniveau, runtime aanpasbaar. Dit is pino's eigen `level`: zetten
   * werkt direct en zonder herstart. Niet persistent — bij een herstart valt de
   * omgeving terug op `LOG_LEVEL` uit de env, de bron van waarheid.
   */
  level: string;
}

export function createLogger(level: string, base: Record<string, unknown> = {}): Logger {
  return pino({ level, base });
}

/**
 * Wraps een bestaande Logger: warn en error schrijven naar de buffer én naar de
 * inner logger; info en debug gaan alleen naar de inner logger. child() geeft
 * opnieuw een buffered logger terug met dezelfde buffer.
 */
export function createBufferedLogger(inner: Logger, buffer: LogBuffer): Logger {
  return {
    debug: (context, message) => inner.debug(context, message),
    info: (context, message) => inner.info(context, message),
    warn: (context, message) => {
      buffer.add('warn', message);
      inner.warn(context, message);
    },
    error: (context, message) => {
      buffer.add('error', message);
      inner.error(context, message);
    },
    child: (bindings) => createBufferedLogger(inner.child(bindings), buffer),
    get level() {
      return inner.level;
    },
    set level(value: string) {
      inner.level = value;
    },
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
  level: 'silent',
};
