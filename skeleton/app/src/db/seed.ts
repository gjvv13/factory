import { systemClock } from '../core/clock.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations } from './client.js';
import { loadTestData } from './testdata.js';

const config = loadConfig();

if (config.environment === 'prod') {
  console.error('Seeden van productie is geblokkeerd: dit zou echte data wissen.');
  process.exit(1);
}

const handle = openDatabase(config.databaseFile);
try {
  runMigrations(handle.db, config.migrationsDir);
  loadTestData(handle.db, config.fixturesDir, systemClock.now());
  console.log(`testdata opnieuw ingelezen in ${config.environment} (${config.databaseFile})`);
} finally {
  handle.close();
}
