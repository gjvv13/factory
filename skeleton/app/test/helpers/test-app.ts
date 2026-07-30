import { createApplication, type Application } from '../../src/app.js';
import { createFakeChannel, type FakeChannel } from '../../src/channels/fake-channel.js';
import { fixedClock, type Clock } from '../../src/core/clock.js';
import { silentLogger } from '../../src/core/logger.js';
import { loadConfig, type Config } from '../../src/config.js';
import { loadTestData } from '../../src/db/testdata.js';

export const TEST_INSTANT = '2026-01-15T10:00:00.000Z';

export interface TestApp {
  readonly app: Application;
  readonly channel: FakeChannel;
  readonly config: Config;
  /** Leest de testdata opnieuw in, zodat elke test met dezelfde verse set start. */
  reloadTestData(): void;
  close(): void;
}

/**
 * Volledige applicatie op een in-memory database. Geen netwerk, geen bestanden:
 * snel genoeg om per test een verse instantie te maken.
 */
export async function createTestApp(clock: Clock = fixedClock(TEST_INSTANT)): Promise<TestApp> {
  const config = loadConfig({
    FACTORY_ENV: 'test',
    DATABASE_FILE: ':memory:',
    LOG_LEVEL: 'silent',
    FLAG_CACHE_TTL_MS: '0',
  });
  const app = createApplication(config, { clock, logger: silentLogger });
  const reloadTestData = (): void => {
    loadTestData(app.db, config.fixturesDir, clock.now());
  };
  reloadTestData();

  const channel = createFakeChannel(clock);
  await channel.start(app.messageService);

  return {
    app,
    channel,
    config,
    reloadTestData,
    close: () => {
      app.close();
    },
  };
}
