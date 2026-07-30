import Fastify, { type FastifyInstance } from 'fastify';
import type { Application } from '../app.js';
import { flagRoutes } from './routes/flags.js';
import { healthRoutes } from './routes/health.js';
import { inboundRoutes } from './routes/inbound.js';

export function buildServer(app: Application): FastifyInstance {
  // Requestlogging volgt het logniveau: 'info' logt elk verzoek,
  // 'warn' houdt het stil, 'silent' logt niets (tests).
  const server = Fastify({ logger: { level: app.config.logLevel } });

  server.register(healthRoutes(app));
  server.register(flagRoutes(app));
  server.register(inboundRoutes(app));

  server.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Onbekende route: ${request.method} ${request.url}` });
  });

  return server;
}
