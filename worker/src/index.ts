// Rarely API Worker: POST /submit, GET /tiers.json, /admin, and the hourly cron.
// Paths work with or without an "/api" prefix, so the Worker can sit on its own
// hostname or under /api/* on the site's domain.
import { ADMIN_HTML, adminAction, adminPublish, adminState, requireAdmin } from './admin';
import type { Env } from './live';
import { runNightly, TIERS_KEY } from './nightly';
import { handleSubmit, HttpError } from './submit';

function cors(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS' && (path === '/submit' || path === '/tiers.json')) {
    return new Response(null, { status: 204, headers: cors(env) });
  }

  if (path === '/submit' && method === 'POST') {
    return withHeaders(await handleSubmit(req, env), cors(env));
  }

  if (path === '/tiers.json' && (method === 'GET' || method === 'HEAD')) {
    let body = await env.TIERS.get(TIERS_KEY);
    if (!body) {
      await runNightly(env, { force: true }); // first request after deploy
      body = (await env.TIERS.get(TIERS_KEY)) ?? '{}';
    }
    return new Response(method === 'HEAD' ? null : body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', ...cors(env) },
    });
  }

  if (path === '/admin' && method === 'GET') {
    return new Response(ADMIN_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      },
    });
  }

  if (path.startsWith('/admin/api/')) {
    requireAdmin(req, env);
    const op = path.slice('/admin/api/'.length);
    if (op === 'state' && method === 'GET') return Response.json(await adminState(env), { headers: { 'cache-control': 'no-store' } });
    if (op === 'action' && method === 'POST') return Response.json(await adminAction(req, env));
    if (op === 'publish' && method === 'POST') return Response.json(await adminPublish(env));
  }

  if (path === '/' && method === 'GET') return Response.json({ ok: true, service: 'rarely-api' });
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      const message = err instanceof HttpError ? err.message : 'Internal error';
      return Response.json({ error: message }, { status, headers: cors(env) });
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runNightly(env).then((r) => {
        if (r.ran) console.log(`nightly: published tiers for ${r.date}`, JSON.stringify(r));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
