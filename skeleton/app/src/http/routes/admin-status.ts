import type { FastifyPluginCallback } from 'fastify';
import type { Application } from '../../app.js';
import { configReport } from '../../core/config-status.js';
import { migrationReport } from '../../core/migratie-status.js';
import { readApplied, readJournal } from '../../db/migraties.js';

/**
 * Status-endpoints voor het beheerconsole: migraties en configuratie.
 * Alleen bereikbaar via de loopback-interface (de server bindt op 127.0.0.1),
 * dus geen aparte authenticatie nodig — net als flags en logs.
 */
export function adminStatusRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.get('/admin/migrations', () => {
      const journal = readJournal(app.config.migrationsDir);
      const applied = readApplied(app.db);
      return migrationReport(journal, applied);
    });

    server.get('/admin/config', () =>
      configReport(app.config.verwachteSleutels, app.config.presentKeys, app.config.emptyKeys),
    );

    done();
  };
}
