import cors from 'cors';
import express, { Express, ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileIndexingStore } from './infrastructure/indexing/file-indexing-store.js';
import { IndexingStore } from './infrastructure/indexing/indexing-store.js';
import { installSecurity, rateLimit } from './middleware/security.js';
import { AppConfig } from './config.js';
import { GitHubClient } from './infrastructure/github/github-client.js';
import { Neo4jConnection } from './infrastructure/graph/neo4j-connection.js';
import { GraphStore } from './infrastructure/graph/graph-store.js';
import { GraphReader } from './infrastructure/graph/graph-reader.js';
import { InMemoryIndexingStore } from './infrastructure/indexing/in-memory-indexing-store.js';
import { createAskRouter } from './routes/ask-routes.js';
import { createRepositoryRouter } from './routes/repository-routes.js';
import { AnswerProvider } from './domain/answer-prompt.js';
import { SarvamTranslator } from './infrastructure/sarvam/sarvam-translator.js';
import { SerpApiClient } from './infrastructure/search/serpapi-client.js';
import { IndexingService } from './services/indexing-service.js';
import { QuestionService } from './services/question-service.js';
import { AccountService } from './services/account-service.js';
import { createPrivateRouter } from './routes/private-routes.js';
import { GuestWorkspaces } from './services/guest-workspace.js';
import { repositoryFromId, repositoryIdFor } from './utils/repository.js';
import { AccountWorkspaceStore } from './infrastructure/account-workspace-store.js';
import { importedInvestigation } from './domain/imported-investigation.js';
import type { AskResponse } from './domain/question.js';
import type { SharedAuthFlows } from './infrastructure/shared-auth-flows.js';
import type { SharedSessions } from './infrastructure/shared-sessions.js';
import type { SharedGuestWorkspaces } from './infrastructure/shared-guest-workspaces.js';
import type { CentralIndexStore } from './infrastructure/indexing/central-index-store.js';
import { sharedRateLimitHealth } from './infrastructure/shared-rate-limit.js';

// Optional dependencies assembled outside the app so the server can manage their lifecycle.
export interface AppDependencies {
  authFlows?: SharedAuthFlows;
  sessions?: SharedSessions;
  guestWorkspaces?: SharedGuestWorkspaces;
  privateIndexes?: (scope:{id:string;expires:number})=>CentralIndexStore;
  reserveAnswer?: () => Promise<boolean>;
  store?: IndexingStore;
  neo4j?: Neo4jConnection;
  graph?: GraphStore;
  reader?: GraphReader;
  answerProvider?: AnswerProvider;
  translator?: SarvamTranslator;
  externalSearch?: SerpApiClient;
}

// Builds the HTTP application from explicit dependencies for local runs and future tests.
export function createApp(config: AppConfig, dependencies: AppDependencies = {}): Express {
  const github = new GitHubClient(config.githubApiUrl, config.githubToken);
  const store = dependencies.store ?? (config.dataDirectory ? new FileIndexingStore(config.dataDirectory) : new InMemoryIndexingStore());
  const indexing = new IndexingService(github, store, dependencies.graph);
  const reserveAnswer = dependencies.reserveAnswer ?? (async () => !(store instanceof FileIndexingStore) || store.reserveAnswer(config.dailyAnswerLimit ?? 100));
  const questions = dependencies.reader
    ? new QuestionService(dependencies.reader, dependencies.answerProvider, dependencies.translator, dependencies.externalSearch)
    : undefined;
  const app = express();
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.get('/healthz', (_request, response) => response.type('text/plain').send('ok'));
  app.use(cors({ origin: config.publicOrigin ?? config.clientOrigin, credentials: true, allowedHeaders: ['Content-Type', 'X-WhyCode-Request'] }));
  app.use(express.json({ limit: '32kb' }));
  installSecurity(app, config);
  const accounts = new AccountService(config, dependencies.authFlows, dependencies.sessions);
  const accountStore = new AccountWorkspaceStore(config);
  const guests = new GuestWorkspaces(Boolean(config.production), request => accounts.workspaceIdentity(request), response => accounts.clearSessionCookie(response), dependencies.guestWorkspaces);
  app.use('/api/account', accounts.router);
  app.use('/api/private', createPrivateRouter(accounts, config, dependencies, reserveAnswer, accountStore));
  app.use('/api/repositories/ingest', rateLimit(6, 10 * 60_000, config.sharedRateLimits, 'public-ingest'));
  app.use('/api/ask', rateLimit(15, 15 * 60_000, config.sharedRateLimits, 'public-ask'));
  app.use('/api/repositories', guests.middleware);
  app.use('/api/ask', guests.middleware);
  app.use('/api/workspace', guests.middleware);
  app.get('/api/workspace/history', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session && accounts.hasSessionCookie(request)) { response.status(503).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account verification is unavailable. Please retry.', retryable: true } }); return; }
    if (!session) { response.json({ history: guests.history(request), persistence: 'temporary' }); return; }
    try {
      const [saved, repositories] = await Promise.all([accountStore.list(session, 'public'), accountStore.listRepositories(session, 'public')]);
      for (const item of [...saved, ...repositories]) guests.add(request, item.repositoryId);
      const keys = new Set(saved.map(item => `${item.repositoryId}:${item.answeredAt}`));
      const temporary = guests.history(request).filter(item => !keys.has(`${item.repositoryId}:${item.answeredAt}`));
      response.json({ history: [...temporary, ...saved], repositories, persistence: 'account' });
    } catch { response.json({ history: guests.history(request), persistence: 'temporary', warning: 'Account history is unavailable. New work is temporary until account storage is configured.' }); }
  });
  app.post('/api/workspace/history/clear', (request, response) => { guests.clearHistory(request); response.json({ cleared: true }); });
  app.post('/api/workspace/history/remove', (request, response) => {
    const { repositoryId, answeredAt } = request.body ?? {};
    if (typeof repositoryId !== 'string' || typeof answeredAt !== 'string' || !guests.removeAnswer(request, repositoryId, answeredAt)) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Investigation not found in your workspace.', retryable: false } }); return;
    }
    response.json({ removed: true });
  });
  app.post('/api/account/workspace/history/remove', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to manage saved investigations.', retryable: false } }); return; }
    try { await accountStore.remove(session, request.body?.id); response.json({ removed: true }); }
    catch (error) {
      if (error instanceof Error && (error.message === 'NOT_FOUND' || error.message === 'INVALID_ID')) { response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Investigation not found in your account.', retryable: false } }); return; }
      response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Could not delete the saved investigation. Please retry.', retryable: true } });
    }
  });
  app.post('/api/account/workspace/history/clear', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to manage saved investigations.', retryable: false } }); return; }
    const visibility = request.body?.visibility;
    if (visibility !== 'public' && visibility !== 'private') { response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Choose public or private investigations.', retryable: false } }); return; }
    try { await accountStore.clear(session, visibility); response.json({ cleared: true }); }
    catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Could not clear saved investigations. Please retry.', retryable: true } }); }
  });
  app.get('/api/account/workspace/guest-preview', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to import guest work.', retryable: false } }); return; }
    try {
      const guest = await guests.guestData(request);
      response.json({ repositories: guest.repositories.length, investigations: guest.history.length });
    } catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Guest workspace is temporarily unavailable.', retryable: true } }); }
  });
  app.post('/api/account/workspace/import-guest', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to import guest work.', retryable: false } }); return; }
    try {
      const guest = await guests.guestData(request);
      const existing = await accountStore.list(session, 'public');
      const keys = new Set(existing.map(item => `${item.repositoryId}:${item.answeredAt}`));
      let imported = 0;
      for (const id of guest.repositories) {
        const repository = repositoryFromId(id);
        if (repository) await accountStore.addRepository(session, 'public', repositoryIdFor(repository), repository);
      }
      for (const item of guest.history) {
        const key = `${item.repositoryId}:${item.answeredAt}`;
        if (!keys.has(key)) { await accountStore.save(session, 'public', item); keys.add(key); imported++; }
      }
      response.json({ imported, repositories: guest.repositories.length });
    } catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Import could not finish. Guest work is still available; retry after account storage is set up.', retryable: true } }); }
  });
  app.post('/api/account/workspace/import-browser', async (request, response) => {
    const session = await accounts.authenticate(request);
    if (!session) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to import browser history.', retryable: false } }); return; }
    const parsed = importedInvestigation.safeParse(request.body?.answer);
    const repository = parsed.success ? repositoryFromId(parsed.data.repositoryId) : null;
    if (!parsed.success || !repository || repositoryIdFor(repository) !== parsed.data.repositoryId) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'This browser investigation could not be imported.', retryable: false } }); return;
    }
    try {
      const old = await accountStore.list(session, 'public');
      const duplicate = old.some(item => item.repositoryId === parsed.data.repositoryId && item.answeredAt === parsed.data.answeredAt);
      await accountStore.addRepository(session, 'public', parsed.data.repositoryId, repository);
      if (!duplicate) await accountStore.save(session, 'public', parsed.data as unknown as AskResponse);
      response.json({ imported: !duplicate });
    } catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Import could not finish. Browser history has not been removed.', retryable: true } }); }
  });
  app.post('/api/repositories/:repositoryId/remove', async (request, response) => {
    const repository = repositoryFromId(request.params.repositoryId);
    const id = repository && repositoryIdFor(repository);
    if (!id || !guests.includes(request, id)) { response.status(404).json({ error: { code: 'NOT_FOUND', message: 'This repository is not in your workspace.', retryable: false } }); return; }
    const session = await accounts.authenticate(request);
    if (!session && accounts.hasSessionCookie(request)) { response.status(503).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account verification is unavailable. Please retry.', retryable: true } }); return; }
    if (session) {
      try { await accountStore.removeRepository(session, 'public', id); }
      catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Saved investigations could not be removed. Please retry.', retryable: true } }); return; }
    }
    guests.remove(request, id); response.json({ removed: true });
  });
  app.post('/api/ask', async (_request, response, next) => {
    const repository = repositoryFromId(_request.body?.repositoryId ?? '');
    if (repository && !guests.includes(_request, repositoryIdFor(repository))) {
      response.status(404).json({ error: { code: 'INDEX_NOT_READY', message: 'This repository is not in your workspace.', retryable: false } }); return;
    }
    try { if (!await reserveAnswer()) {
      response.status(429).json({ error: { code: 'DAILY_LIMIT', message: 'The workspace daily answer budget has been reached. Try again tomorrow.', retryable: false } });
      return;
    } } catch { response.status(503).json({ error: { code: 'BUDGET_UNAVAILABLE', message: 'Answer usage tracking is temporarily unavailable. Please retry.', retryable: true } }); return; }
    next();
  });

  // Reports service and optional dependency configuration without exposing secret values.
  const checkDatabase=createDatabaseHealth(dependencies.neo4j);
  app.get('/api/health', async (_request, response) => {
    response.json({
      status: 'ok',
      service: 'whycode-api',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: await checkDatabase(),
        rateLimitStore: sharedRateLimitHealth(config.sharedRateLimits),
        github: config.githubToken ? 'authenticated' : 'public_api',
        answerProvider: dependencies.answerProvider
          ? `configured:${dependencies.answerProvider.model}`
          : 'not_configured',
        externalSearch: dependencies.externalSearch ? 'configured' : 'disabled',
        translation: dependencies.translator ? 'configured' : 'disabled',
        persistence: config.postgres ? 'shared' : store instanceof FileIndexingStore ? 'durable' : 'memory',
        access: 'public',
      },
    });
  });

  app.use('/api/repositories', createRepositoryRouter(indexing, dependencies.reader, guests, async (request, id, repository) => {
    const session = await accounts.authenticate(request);
    if (!session) { if (accounts.hasSessionCookie(request)) throw new Error('ACCOUNT_UNAVAILABLE'); return; }
    await accountStore.addRepository(session, 'public', id, repository);
  }));
  if (questions) {
    app.use('/api', createAskRouter(questions, indexing, async (request, answer) => {
      const session = await accounts.authenticate(request);
      if (!session && accounts.hasSessionCookie(request)) { guests.save(request, answer); answer.warnings.push('Account verification is unavailable; this answer is temporary.'); return true; }
      if (!session) return guests.save(request, answer);
      try { (answer as typeof answer & { savedId?: string }).savedId = await accountStore.save(session, 'public', answer); return true; }
      catch { guests.save(request, answer); answer.warnings.push('Account storage is unavailable; this answer is temporary.'); return true; }
    }));
  } else {
    app.post('/api/ask', (_request, response) => {
      response.status(503).json({ error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Question answering requires Neo4j. Configure the database and index the repository again.',
        retryable: false,
      } });
    });
  }

  const webDirectory = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  app.get('/robots.txt',(_request,response)=>response.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /workspace\nSitemap: ${new URL(config.publicOrigin??config.clientOrigin).origin}/sitemap.xml\n`));
  app.get('/sitemap.xml',(_request,response)=> {
    const origin=new URL(config.publicOrigin??config.clientOrigin).origin;
    response.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/help</loc></url></urlset>`);
  });
  if (existsSync(webDirectory)) {
    app.use(express.static(webDirectory));
    app.get('/', (_request, response) => response.sendFile('index.html', { root: webDirectory }));
    app.get('/account', (_request, response) => response.sendFile('index.html', { root: webDirectory }));
    app.get(['/workspace','/help'], (_request, response) => response.sendFile('index.html', { root: webDirectory }));
  }

  // Returns one stable error shape for routes that do not exist.
  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested API route does not exist.',
        retryable: false,
      },
    });
  });

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    response.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', message: status === 500 ? 'The request could not be completed. Please retry.' : 'Send a valid JSON request smaller than 32 KB.', retryable: status === 500 } });
  };
  app.use(errors);
  return app;
}

// Reports real Neo4j availability while keeping the health endpoint resilient.
function createDatabaseHealth(connection: Neo4jConnection | undefined): ()=>Promise<string> {
  let value='unreachable',expires=0,pending:Promise<string>|undefined;
  return async ()=> {
  if (!connection) {
    return 'memory_store';
  }
  if(Date.now()<expires)return value;
  if(pending)return pending;
  pending=(async()=>{try{await connection.verifyConnectivity();value='connected';}catch{value='unreachable';}expires=Date.now()+15_000;return value;})().finally(()=>{pending=undefined;});
  return pending;
  };
}
