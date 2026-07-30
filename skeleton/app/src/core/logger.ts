import { pino } from 'pino';

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

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
