import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/core/clock.js';
import { LogBuffer } from '../../src/core/log-buffer.js';
import { createBufferedLogger, silentLogger } from '../../src/core/logger.js';

describe('LogBuffer', () => {
  const clock = fixedClock('2026-01-15T10:00:00.000Z');
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(clock);
  });

  it('is leeg bij start', () => {
    expect(buffer.recent()).toEqual([]);
  });

  it('slaat warn- en error-entries op', () => {
    buffer.add('warn', 'een waarschuwing');
    buffer.add('error', 'een fout');

    const entries = buffer.recent();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      tijdstip: '2026-01-15T10:00:00.000Z',
      niveau: 'error',
      bericht: 'een fout',
    });
    expect(entries[1]).toEqual({
      tijdstip: '2026-01-15T10:00:00.000Z',
      niveau: 'warn',
      bericht: 'een waarschuwing',
    });
  });

  it('geeft entries nieuwste eerst terug', () => {
    buffer.add('warn', 'eerste');
    buffer.add('warn', 'tweede');
    buffer.add('error', 'derde');

    const berichten = buffer.recent().map((e) => e.bericht);
    expect(berichten).toEqual(['derde', 'tweede', 'eerste']);
  });

  it('laat de oudste entry vallen bij overschrijding van de capaciteit', () => {
    const kleinBuffer = new LogBuffer(clock, 3);

    kleinBuffer.add('warn', 'a');
    kleinBuffer.add('warn', 'b');
    kleinBuffer.add('warn', 'c');
    kleinBuffer.add('error', 'd');

    const entries = kleinBuffer.recent();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.bericht)).toEqual(['d', 'c', 'b']);
  });

  it('blijft correct na meerdere ronden overschrijding', () => {
    const kleinBuffer = new LogBuffer(clock, 2);

    kleinBuffer.add('warn', 'a');
    kleinBuffer.add('warn', 'b');
    kleinBuffer.add('warn', 'c');
    kleinBuffer.add('warn', 'd');
    kleinBuffer.add('error', 'e');

    const entries = kleinBuffer.recent();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.bericht)).toEqual(['e', 'd']);
  });
});

describe('createBufferedLogger', () => {
  const clock = fixedClock('2026-01-15T10:00:00.000Z');

  it('schrijft warn en error naar de buffer én naar de inner logger', () => {
    const buffer = new LogBuffer(clock);
    const calls: string[] = [];
    const inner = {
      ...silentLogger,
      warn: (_ctx: Record<string, unknown>, msg: string) => calls.push(`warn:${msg}`),
      error: (_ctx: Record<string, unknown>, msg: string) => calls.push(`error:${msg}`),
    };

    const logger = createBufferedLogger(inner, buffer);
    logger.warn({}, 'let op');
    logger.error({}, 'kapot');

    expect(buffer.recent()).toHaveLength(2);
    expect(calls).toEqual(['warn:let op', 'error:kapot']);
  });

  it('schrijft info en debug niet naar de buffer', () => {
    const buffer = new LogBuffer(clock);
    const logger = createBufferedLogger(silentLogger, buffer);

    logger.info({}, 'info bericht');
    logger.debug({}, 'debug bericht');

    expect(buffer.recent()).toEqual([]);
  });

  it('child deelt dezelfde buffer', () => {
    const buffer = new LogBuffer(clock);
    const logger = createBufferedLogger(silentLogger, buffer);
    const child = logger.child({ module: 'test' });

    child.warn({}, 'vanuit child');
    logger.error({}, 'vanuit ouder');

    expect(buffer.recent()).toHaveLength(2);
    expect(buffer.recent().map((e) => e.bericht)).toEqual(['vanuit ouder', 'vanuit child']);
  });
});
