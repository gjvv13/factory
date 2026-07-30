import type { FastifyPluginCallback } from 'fastify';
import type { Application } from '../../app.js';

/** Vrij opvraagbaar: gebruikt door promote-scripts en pm2 om te zien of een omgeving leeft. */
export function healthRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.get('/health', () => ({
      status: 'ok',
      environment: app.config.environment,
      version: app.config.version,
      channel: app.config.channel,
      uptimeSeconds: Math.round(process.uptime()),
    }));
    done();
  };
}
