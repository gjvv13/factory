import { describe, expect, it } from 'vitest';
import { isVeilig, labelNaarPatroon, VEILIGE_KLASSE } from '../src/veilige-klasse.js';

describe('VEILIGE_KLASSE', () => {
  it('bevat alleen Bash-patronen', () => {
    for (const patroon of VEILIGE_KLASSE) {
      expect(patroon).toMatch(/^Bash\(.+:\*\)$/);
    }
  });

  it('bevat geen rm, git -C, curl, chmod of gh', () => {
    // De functionele besluiten sluiten deze expliciet uit.
    for (const patroon of VEILIGE_KLASSE) {
      expect(patroon).not.toMatch(/\brm\b/);
      expect(patroon).not.toMatch(/\bgit -C\b/);
      expect(patroon).not.toMatch(/\bcurl\b/);
      expect(patroon).not.toMatch(/\bwget\b/);
      expect(patroon).not.toMatch(/\bchmod\b/);
      expect(patroon).not.toMatch(/\bchown\b/);
      expect(patroon).not.toMatch(/\bgh\b/);
      expect(patroon).not.toMatch(/\bgit push\b/);
    }
  });
});

describe('isVeilig', () => {
  it('herkent bekende neveneffect-vrije labels als veilig', () => {
    expect(isVeilig('diff')).toBe(true);
    expect(isVeilig('sort')).toBe(true);
    expect(isVeilig('jq')).toBe(true);
    expect(isVeilig('stat')).toBe(true);
    expect(isVeilig('printenv')).toBe(true);
  });

  it('weigert verba die met vijandige argumenten willekeurige exec of schrijven toelaten (#751)', () => {
    // Deze stonden ooit in de klasse maar zijn geen neveneffect-vrije verba: via de
    // auto-groei zouden ze een sluiproute naar netwerk/push/gh/schrijven openen.
    for (const label of ['env', 'awk', 'sed', 'find', 'xargs', 'tee']) {
      expect(isVeilig(label), `${label} hoort niet in de veilige klasse`).toBe(false);
    }
  });

  it('weigert rm', () => {
    expect(isVeilig('rm')).toBe(false);
  });

  it('weigert git -C', () => {
    expect(isVeilig('git -C')).toBe(false);
  });

  it('weigert curl', () => {
    expect(isVeilig('curl')).toBe(false);
  });

  it('weigert gh issue edit', () => {
    expect(isVeilig('gh issue edit')).toBe(false);
  });

  it('weigert chmod', () => {
    expect(isVeilig('chmod')).toBe(false);
  });

  it('weigert git push', () => {
    expect(isVeilig('git push')).toBe(false);
  });

  it('weigert een niet-Bash tool als Write', () => {
    expect(isVeilig('Write')).toBe(false);
  });
});

describe('labelNaarPatroon', () => {
  it('vertaalt een enkelvoudig label naar een Bash-patroon', () => {
    expect(labelNaarPatroon('diff')).toBe('Bash(diff:*)');
    expect(labelNaarPatroon('jq')).toBe('Bash(jq:*)');
  });

  it('vertaalt een samengesteld label', () => {
    expect(labelNaarPatroon('git push')).toBe('Bash(git push:*)');
  });
});
