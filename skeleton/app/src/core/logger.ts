import { pino } from 'pino';
import type { LogBuffer } from './log-buffer.js';

export interface Logger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
  child(bindings: Record<string, unknown>): Logger;
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
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
