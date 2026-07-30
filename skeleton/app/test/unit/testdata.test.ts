import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contacts, featureFlags, messageLog } from '../../src/db/schema.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('testdata opnieuw inlezen', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
  });

  afterEach(() => {
    harness.close();
  });

  it('laadt de contacten en flags uit de fixtures', () => {
    expect(harness.app.db.select().from(contacts).all()).toHaveLength(4);
    expect(harness.app.db.select().from(featureFlags).all()).toHaveLength(2);
  });

  it('wist wijzigingen van een vorige test bij opnieuw inlezen', () => {
    harness.app.db
      .insert(contacts)
      .values({ channel: 'fake', handle: 'rommel', displayName: 'Rommel' })
      .run();
    harness.app.flags.set('tijdelijk', true);
    harness.channel.receive('tester', 'ping');

    harness.reloadTestData();
    harness.app.flags.invalidate();

    expect(harness.app.contacts.findByHandle('fake', 'rommel')).toBeUndefined();
    expect(harness.app.flags.isEnabled('tijdelijk')).toBe(false);
    expect(harness.app.db.select().from(messageLog).all()).toHaveLength(0);
  });

  it('is idempotent: twee keer inlezen geeft dezelfde inhoud', () => {
    harness.reloadTestData();
    harness.reloadTestData();
    expect(harness.app.db.select().from(contacts).all()).toHaveLength(4);
  });
});
