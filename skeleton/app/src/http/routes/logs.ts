import type { FastifyPluginCallback } from 'fastify';
import type { Application } from '../../app.js';

/**
 * Recente warn/error-logregels uit de in-memory buffer.
 * Achter de flag `admin-logs`: bij flag uit geeft de route een 404, alsof het
 * endpoint niet bestaat — consistent met hoe geflaggerde commando's uit help
 * verdwijnen.
 */
export function logRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.get('/admin/logs', (_request, reply) => {
      if (!app.flags.isEnabled('admin-logs')) {
        return reply.code(404).send({ error: 'Onbekende route: GET /admin/logs' });
      }
      return { entries: app.logBuffer.recent() };
    });

    done();
  };
}
