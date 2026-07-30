import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('message-service', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
    harness.reloadTestData();
  });

  afterEach(() => {
    harness.close();
  });

  it('logt zowel het inkomende bericht als het antwoord', () => {
    harness.channel.receive('tester', 'ping');
    const logged = harness.app.messageLog.recent(10);

    expect(logged).toHaveLength(2);
    expect(logged.map((entry) => entry.direction)).toEqual(['out', 'in']);
    expect(logged.find((entry) => entry.direction === 'in')?.text).toBe('ping');
    expect(logged.find((entry) => entry.direction === 'out')?.text).toBe('pong');
  });

  it('legt het kanaal en de deelnemer vast', () => {
    harness.channel.receive('+31600000009', 'versie');
    const inbound = harness.app.messageLog.recent(10).find((entry) => entry.direction === 'in');

    expect(inbound?.channel).toBe('fake');
    expect(inbound?.participant).toBe('+31600000009');
  });

  it('geeft de nieuwste berichten eerst terug en respecteert de limiet', () => {
    harness.channel.receive('tester', 'ping');
    harness.channel.receive('tester', 'versie');

    const logged = harness.app.messageLog.recent(2);
    expect(logged).toHaveLength(2);
    expect(logged[0]?.text).toContain('Factory');
  });
});
