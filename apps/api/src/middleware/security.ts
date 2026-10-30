import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction, Express } from 'express';
import { AppConfig } from '../config.js';
import { sharedRateLimit, type SharedLimitConfig } from '../infrastructure/shared-rate-limit.js';

function fail(response: Response, status: number, code: string, message: string, retryable = false) {
  response.status(status).json({ error: { code, message, retryable } });
}
export function rateLimit(limit: number, windowMs: number, shared?: SharedLimitConfig, scope = 'default') {
  const clients = new Map<string, { count: number; reset: number }>();
  let degradedUntil=0;
  const safeRead=(request:Request)=>request.method==='GET' && /^\/api\/(?:health|auth\/session|account\/session|account\/workspace\/guest-preview|workspace\/history|repositories(?:\/[^/]+\/(?:status|graph))?|private\/(?:health|workspace\/history|repositories(?:\/[^/]+\/(?:status|graph))?))$/.test(request.originalUrl.split('?')[0]);
  const local = (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    for (const [key, item] of clients) if (item.reset <= now) clients.delete(key);
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    if (!clients.has(key) && clients.size >= 5000) { fail(response, 429, 'RATE_LIMITED', 'Server is busy. Try again shortly.', true); return; }
    const entry = clients.get(key) ?? { count: 0, reset: now + windowMs };
    entry.count++; clients.set(key, entry);
    if (entry.count > limit) {
      response.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      fail(response, 429, 'RATE_LIMITED', 'Too many requests. Please wait before trying again.', true); return;
    }
    next();
  };
  return (request: Request, response: Response, next: NextFunction) => {
    if (shared && !(degradedUntil>Date.now()&&safeRead(request))) {
      void sharedRateLimit(shared, scope, request.ip ?? request.socket.remoteAddress ?? 'unknown', windowMs).then(result => {
        if (result.count > limit) {
          response.setHeader('Retry-After', result.retryAfter);
          fail(response, 429, 'RATE_LIMITED', 'Too many requests. Please wait before trying again.', true);
        } else next();
      }).catch(() => {
        if(!safeRead(request)) { fail(response, 503, 'RATE_LIMIT_UNAVAILABLE', 'Request protection is temporarily unavailable. Please retry shortly.', true);return; }
        if(Date.now()>=degradedUntil)console.warn(JSON.stringify({event:'rate_limit_read_fallback',scope,durationSeconds:60}));
        degradedUntil=Date.now()+60_000;
        response.setHeader('X-WhyCode-Rate-Limit','degraded');local(request,response,next);
      });
      return;
    }
    if(shared)response.setHeader('X-WhyCode-Rate-Limit','degraded');
    local(request,response,next);
  };
}
export function installSecurity(app: Express, config: AppConfig) {
  const allowedOrigins = new Set([config.clientOrigin, config.publicOrigin, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`].filter(Boolean));
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const id = randomUUID();
    response.setHeader('X-Request-Id', id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${config.production ? '' : " 'unsafe-inline'"}; style-src 'self'${config.production ? '' : " 'unsafe-inline'"}; img-src 'self' data:; connect-src 'self'${config.production ? '' : ' ws://localhost:5173 ws://127.0.0.1:5173'}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    if (config.production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    if (config.production && !request.secure) { fail(response, 426, 'HTTPS_REQUIRED', 'HTTPS is required for this workspace.'); return; }
    const hostname = request.hostname.toLowerCase();
    const permittedHost = config.production ? new URL(config.publicOrigin!).hostname : undefined;
    if (permittedHost ? hostname !== permittedHost : !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      fail(response, 403, 'HOST_REJECTED', 'This host is not allowed.'); return;
    }
    const origin = request.get('origin');
    if (origin && !allowedOrigins.has(origin)) { fail(response, 403, 'ORIGIN_REJECTED', 'This origin is not allowed.'); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.get('x-whycode-request') !== '1' || !request.is('application/json')) {
        fail(response, 403, 'REQUEST_REJECTED', 'Use the application to submit this request.'); return;
      }
      if (request.get('sec-fetch-site') === 'cross-site') { fail(response, 403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed.'); return; }
    }
    if (request.path.startsWith('/api/')) {
      const started = Date.now();
      response.once('finish', () => {
        // No bodies, questions, credentials, cookies, or query strings in logs.
        console.info(JSON.stringify({ requestId: id, method: request.method, route: request.route?.path ?? 'api', status: response.statusCode, durationMs: Date.now() - started }));
      });
    }
    next();
  });
  const globalLimit=rateLimit(180,60_000,config.sharedRateLimits,'api');
  const healthLimit=rateLimit(30,60_000);
  app.use('/api',(request,response,next)=>request.path==='/health'?healthLimit(request,response,next):globalLimit(request,response,next));
  // Public exploration needs no shared credential. Private routes verify account identity separately.
  app.get('/api/auth/session', (_request, response) => response.json({ required: false, authenticated: true }));
}
