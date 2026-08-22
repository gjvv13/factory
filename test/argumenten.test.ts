import { describe, expect, it } from 'vitest';
import { leesArgumenten } from '../src/argumenten.js';
import { GebruikersFout } from '../src/shell.js';

describe('leesArgumenten', () => {
  it('leest een vlag met waarde in de =-vorm', () => {
    const { waarden } = leesArgumenten(['--repo=gjvv13/backlog'], { waarden: ['--repo'] });
    expect(waarden.get('--repo')).toBe('gjvv13/backlog');
  });

  it('leest dezelfde vlag met een spatie ertussen', () => {
    const { waarden } = leesArgumenten(['--repo', 'gjvv13/backlog'], { waarden: ['--repo'] });
    expect(waarden.get('--repo')).toBe('gjvv13/backlog');
  });

  it('rekent de waarde na een spatie niet mee als positioneel argument', () => {
    const { positioneel } = leesArgumenten(['--repo', 'gjvv13/backlog', 'prod'], {
      waarden: ['--repo'],
    });
    expect(positioneel).toEqual(['prod']);
  });

  it('weigert een onbekende vlag in plaats van hem te negeren', () => {
    expect(() => leesArgumenten(['--snell'], { schakelaars: ['--snel'] })).toThrow(GebruikersFout);
  });

  it('noemt in de fout welke vlaggen het commando wél kent', () => {
    expect(() => leesArgumenten(['--repos=x'], { waarden: ['--repo'] })).toThrow(/--repo/);
  });

  it('weigert een vlag met waarde zonder waarde', () => {
    expect(() => leesArgumenten(['--repo'], { waarden: ['--repo'] })).toThrow(GebruikersFout);
  });

  it('ziet een volgende vlag niet aan voor de waarde', () => {
    expect(() =>
      leesArgumenten(['--repo', '--installeer'], {
        schakelaars: ['--installeer'],
        waarden: ['--repo'],
      }),
    ).toThrow(GebruikersFout);
  });

  it('houdt schakelaars en positionele argumenten uit elkaar', () => {
    const { schakelaars, positioneel } = leesArgumenten(['prod', '--ja', 'v1.2.3'], {
      schakelaars: ['--ja'],
    });
    expect(schakelaars.has('--ja')).toBe(true);
    expect(positioneel).toEqual(['prod', 'v1.2.3']);
  });

  it('weigert elke vlag bij een commando zonder vlaggen', () => {
    expect(() => leesArgumenten(['--snel'])).toThrow(GebruikersFout);
  });

  it('accepteert een waarde die met -- begint in de =-vorm', () => {
    const { waarden } = leesArgumenten(['--titel=--iets'], { waarden: ['--titel'] });
    expect(waarden.get('--titel')).toBe('--iets');
  });

  it('weigert een lege waarde in de =-vorm', () => {
    expect(() => leesArgumenten(['--titel='], { waarden: ['--titel'] })).toThrow(GebruikersFout);
  });

  it('weigert een waarde die met -- begint in de gescheiden vorm', () => {
    expect(() =>
      leesArgumenten(['--titel', '--dry'], { waarden: ['--titel'], schakelaars: ['--dry'] }),
    ).toThrow(GebruikersFout);
  });
});
