import { loadConfig } from '../config.js';
import { openDatabase, runMigrations } from './client.js';

const config = loadConfig();
const handle = openDatabase(config.databaseFile);
try {
  runMigrations(handle.db, config.migrationsDir);
  console.log(`migraties toegepast op ${config.environment} (${config.databaseFile})`);
} finally {
  handle.close();
}
