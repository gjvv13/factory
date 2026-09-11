import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_COMMAND_REPLY } from '../../src/core/command-router.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('commando-router', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
    // Verse testdata voor elke test: geen doorwerking van vorige tests.
    harness.reloadTestData();
  });

  afterEach(() => {
    harness.close();
  });

  it('antwoordt op ping met pong — altijd, zonder flag', () => {
    // ping is een vast diagnose-commando, geen flag nodig (#464).
    expect(harness.channel.receive('tester', 'ping')).toEqual(['pong']);
  });

  it('antwoordt op echo met het argument als de flag aanstaat', () => {
    expect(harness.app.flags.isEnabled('echo')).toBe(true);
    expect(harness.channel.receive('tester', 'echo hallo wereld')).toEqual(['hallo wereld']);
  });

  it('kent echo niet meer zodra de flag uitgaat', () => {
    harness.app.flags.set('echo', false);
    expect(harness.channel.receive('tester', 'echo test')).toEqual([UNKNOWN_COMMAND_REPLY]);
  });

  it('laat een uitgezet commando ook niet in help zien', () => {
    expect(harness.channel.receive('tester', 'help')[0]).toContain('echo');
    harness.app.flags.set('echo', false);
    expect(harness.channel.receive('tester', 'help')[0]).not.toContain('echo');
  });

  it('begroet een bekend contact bij naam', () => {
    expect(harness.channel.receive('tester', 'hallo')).toEqual(['Hallo Unittester!']);
  });

  it('begroet een onbekende afzender neutraal', () => {
    expect(harness.channel.receive('+31999999999', 'hallo')[0]).toContain('ken je nog niet');
  });

  it('negeert hoofdletters en overtollige witruimte', () => {
    expect(harness.channel.receive('tester', '  PING  ')).toEqual(['pong']);
  });

  it('geeft versie en omgeving terug', () => {
    expect(harness.channel.receive('tester', 'versie')[0]).toContain('(test)');
  });

  it('meldt onbekende commandos met een verwijzing naar help', () => {
    expect(harness.channel.receive('tester', 'kaboem')).toEqual([UNKNOWN_COMMAND_REPLY]);
  });
});
