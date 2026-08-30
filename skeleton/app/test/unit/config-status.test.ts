import { describe, expect, it } from 'vitest';
import { configReport } from '../../src/core/config-status.js';

describe('configReport', () => {
  it('geeft ok als alle verwachte sleutels aanwezig en niet-leeg zijn', () => {
    const report = configReport(
      ['DATABASE_URL', 'API_KEY'],
      ['DATABASE_URL', 'API_KEY', 'NODE_ENV'],
      [],
    );

    expect(report.status).toBe('ok');
    expect(report.expected).toBe(2);
    expect(report.missing).toEqual([]);
    expect(report.empty).toEqual([]);
    expect(report.present).toBe(2);
    expect(report.known).toBe(3);
  });

  it('geeft incomplete als een verwachte sleutel ontbreekt', () => {
    const report = configReport(['DATABASE_URL', 'API_KEY'], ['DATABASE_URL'], []);

    expect(report.status).toBe('incomplete');
    expect(report.missing).toEqual(['API_KEY']);
    expect(report.present).toBe(1);
  });

  it('geeft incomplete als een verwachte sleutel leeg is', () => {
    const report = configReport(
      ['DATABASE_URL', 'API_KEY'],
      ['DATABASE_URL', 'API_KEY'],
      ['API_KEY'],
    );

    expect(report.status).toBe('incomplete');
    expect(report.missing).toEqual([]);
    expect(report.empty).toEqual(['API_KEY']);
  });

  it('geeft ok bij geen verwachte sleutels', () => {
    const report = configReport([], ['NODE_ENV', 'PATH'], []);

    expect(report.status).toBe('ok');
    expect(report.expected).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.empty).toEqual([]);
    expect(report.present).toBe(0);
    expect(report.known).toBe(2);
  });

  it('telt een lege niet-verwachte sleutel niet mee als empty', () => {
    const report = configReport(['API_KEY'], ['API_KEY', 'OPTIONAL'], ['OPTIONAL']);

    expect(report.status).toBe('ok');
    expect(report.empty).toEqual([]);
  });

  it('lekt nooit een waarde — het rapport bevat alleen namen en getallen', () => {
    const report = configReport(
      ['SECRET'],
      ['SECRET', 'OTHER'],
      [],
    );

    // Doorloop elke eigenschap: geen enkele mag een waarde bevatten.
    const json = JSON.stringify(report);
    expect(json).not.toContain('waarde');
    // De arrays bevatten alleen strings (sleutelnamen), geen objecten met waarden.
    for (const key of report.missing) {
      expect(typeof key).toBe('string');
    }
    for (const key of report.empty) {
      expect(typeof key).toBe('string');
    }
  });
});
