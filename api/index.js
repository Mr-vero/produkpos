/* Vercel serverless entry: wraps the Fastify app and forwards requests to
 * its internal HTTP server. Local development still uses src/server.js.
 */
process.env.TRUST_PROXY = '1'; // behind Vercel's proxy; rate limit real IPs

const { buildApp } = await import('../src/app.js');

const app = await buildApp({ logger: false });
await app.ready();

export default function handler(req, res) {
  app.server.emit('request', req, res);
}
