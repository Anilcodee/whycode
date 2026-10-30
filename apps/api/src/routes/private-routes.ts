import { Router } from 'express';
import { AccountService, AccountSession } from '../services/account-service.js';
import { AppConfig } from '../config.js';
import { AppDependencies } from '../app.js';
import { InMemoryIndexingStore } from '../infrastructure/indexing/in-memory-indexing-store.js';
import { SnapshotReader } from '../infrastructure/graph/snapshot-reader.js';
import { GitHubClient } from '../infrastructure/github/github-client.js';
import { IndexingService } from '../services/indexing-service.js';
import { QuestionService } from '../services/question-service.js';
import { createRepositoryRouter } from './repository-routes.js';
import { createAskRouter } from './ask-routes.js';
import { rateLimit } from '../middleware/security.js';
import { normalizeRepository, repositoryFromId, repositoryIdFor } from '../utils/repository.js';
import { AccountWorkspaceStore } from '../infrastructure/account-workspace-store.js';
import { EncryptedPrivateStore } from '../infrastructure/indexing/encrypted-private-store.js';
import { createHash } from 'node:crypto';

export function createPrivateRouter(accounts: AccountService, config: AppConfig, dependencies: AppDependencies, reserveAnswer: () => boolean | Promise<boolean> = () => true, accountStore = new AccountWorkspaceStore(config)) {
  const router = Router();
  if (config.sessionStorage) EncryptedPrivateStore.pruneExpired(config.sessionStorage.directory, config.sessionStorage.key);
  const contexts = new Map<AccountSession, { token: string; router: Router; dispose: () => void; recover:()=>void }>();
  accounts.onSessionEnd(session => {
    contexts.get(session)?.dispose(); contexts.delete(session);
    if (config.sessionStorage) EncryptedPrivateStore.removeSession(config.sessionStorage.directory, config.sessionStorage.key, `${session.user.id}:${session.accessToken}`);
  });
  router.use(rateLimit(60, 60_000, config.sharedRateLimits, 'private'));
  router.use('/ask', rateLimit(10, 15 * 60_000, config.sharedRateLimits, 'private-ask'));
  router.use('/repositories/ingest', rateLimit(6, 10 * 60_000, config.sharedRateLimits, 'private-ingest'));
  router.use(async (req, res) => {
    try {
      for (const [session, context] of contexts) if (session.expires <= Date.now() || !session.github || session.github.expires <= Date.now()) { context.dispose(); contexts.delete(session); }
      const session = await accounts.authenticate(req);
      if (!session || !session.github || session.github.expires <= Date.now()) {
        res.status(403).json({ error: { code: 'GITHUB_REQUIRED', message: 'Sign in and connect your GitHub App to access private repositories.', retryable: false } }); return;
      }
      let context = contexts.get(session);
      if (context && context.token !== session.github.token) { context.dispose(); contexts.delete(session); context = undefined; }
      if (!context) {
        if (contexts.size >= 10) { res.status(429).json({ error: { code: 'BUSY', message: 'Private workspaces are at capacity. Try again later.', retryable: true } }); return; }
        const github = new GitHubClient(config.githubApiUrl, session.github.token, true);
        const store = dependencies.privateIndexes ? dependencies.privateIndexes({id:createHash('sha256').update(session.user.id+':'+session.accessToken+':'+session.github.token).digest('hex'),expires:Math.min(session.expires,session.github.expires)}) : config.sessionStorage
          ? new EncryptedPrivateStore(config.sessionStorage.directory, config.sessionStorage.key,
            `${session.user.id}:${session.accessToken}`, Math.min(session.expires, session.github.expires))
          : new InMemoryIndexingStore();
        const reader = new SnapshotReader(store);
        if(dependencies.privateIndexes&&config.sessionStorage) {
          const legacy=new EncryptedPrivateStore(config.sessionStorage.directory,config.sessionStorage.key,`${session.user.id}:${session.accessToken}`,Math.min(session.expires,session.github.expires));
          await (store as ReturnType<NonNullable<AppDependencies['privateIndexes']>>).importLegacy(legacy,createHash('sha256').update(session.user.id+':'+session.accessToken).digest('hex'));
        }
        const indexing = new IndexingService(github, store,undefined,async repository=>{await github.getRepository(repository);});
        const routes = Router();
        routes.get('/health', (_request, response) => response.json({ dependencies: {
          database: 'session', answerProvider: dependencies.answerProvider ? `configured:${dependencies.answerProvider.model}` : 'not_configured',
          translation: 'disabled', externalSearch: 'disabled', access: 'account', persistence: 'session',
        } }));
        routes.get('/workspace/history', async (_request, response) => {
          try {
            const [saved, refs] = await Promise.all([accountStore.list(session, 'private'), accountStore.listRepositories(session, 'private')]);
            const repositories = [...new Set([...saved, ...refs].map(item => repositoryFromId(item.repositoryId)).filter((item): item is string => Boolean(item)))];
            const authorized = new Set<string>();
            for (const repository of repositories) { try { await github.getRepository(repository); authorized.add(repositoryIdFor(repository)); } catch { /* Revoked private data remains hidden. */ } }
            response.json({ history: saved.filter(item => authorized.has(item.repositoryId)), repositories: refs.filter(item => authorized.has(item.repositoryId)), persistence: 'account' });
          } catch { response.json({ history: [], persistence: 'temporary', warning: 'Account history is unavailable. New work is temporary until account storage is configured.' }); }
        });
        // Re-check GitHub authorization on each repository read and write, including graph and answers.
        routes.use(async (request, response, next) => {
          try {
            // Removing an existing session-local snapshot must still work after GitHub access is revoked.
            if (request.method === 'POST' && /^\/repositories\/[^/]+\/remove$/.test(request.path)) { next(); return; }
            if (request.path.replace(/\/+$/, '') === '/repositories' && request.method === 'GET') {
              const statuses = await indexing.listStatuses(); const permitted = [];
              for (const status of statuses) {
                try { await github.getRepository(status.repository); permitted.push(status); } catch { /* Do not expose revoked repositories. */ }
              }
              response.json({ repositories: permitted }); return;
            }
            let repository = normalizeRepository(request.body?.repository ?? '');
            if (!repository && request.body?.repositoryId) repository = repositoryFromId(request.body.repositoryId);
            if (!repository) {
              const match = request.path.match(/^\/repositories\/([^/]+)\/(?:status|graph)$/);
              if (match) repository = repositoryFromId(decodeURIComponent(match[1]));
            }
            if (repository) await github.getRepository(repository);
            if (request.path === '/ask' && request.body?.allowPrivateModel !== true) {
              response.status(403).json({ error: { code: 'CONSENT_REQUIRED', message: 'Allow private source excerpts to be sent to the configured answer model before asking.', retryable: false } }); return;
            }
            next();
          } catch { response.status(403).json({ error: { code: 'REPOSITORY_ACCESS_DENIED', message: 'GitHub access is unavailable or was revoked. Reconnect GitHub and check the selected repositories.', retryable: false } }); }
        });
        routes.post('/repositories/:repositoryId/remove', async (request, response) => {
          const repository = repositoryFromId(request.params.repositoryId);
          const id = repository && repositoryIdFor(repository);
          const status = id ? await store.getStatus(id) : undefined;
          if (!id) { response.status(404).json({ error: { code: 'NOT_FOUND', message: 'This repository is not in your private workspace.', retryable: false } }); return; }
          if (status?.status === 'queued' || status?.status === 'running') { response.status(409).json({ error: { code: 'INDEX_BUSY', message: 'Wait for indexing to finish before removing this repository.', retryable: true } }); return; }
          try { await accountStore.removeRepository(session, 'private', id); }
          catch { response.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Saved investigations could not be removed. Please retry.', retryable: true } }); return; }
          await store.removeRepository(id);
          response.json({ removed: true });
        });
        routes.use('/repositories', createRepositoryRouter(indexing, reader, undefined, (_request, id, repository) => accountStore.addRepository(session, 'private', id, repository)));
        routes.use('/ask', async (_request, response, next) => {
          try { if (!await reserveAnswer()) { response.status(429).json({ error: { code: 'DAILY_LIMIT', message: 'The server daily answer budget has been reached. Try again tomorrow.', retryable: false } }); return; } }
          catch { response.status(503).json({ error: { code: 'BUDGET_UNAVAILABLE', message: 'Answer usage tracking is temporarily unavailable. Please retry.', retryable: true } }); return; }
          next();
        });
        // Private questions never leave through web search or translation; model access is explicit.
        routes.use(createAskRouter(new QuestionService(reader, dependencies.answerProvider), indexing, async (_request, answer) => {
          try { (answer as typeof answer & { savedId?: string }).savedId = await accountStore.save(session, 'private', answer); return true; }
          catch { answer.warnings.push('Account storage is unavailable; this answer is temporary.'); return true; }
        }));
        context = { token: session.github.token, router: routes, recover:()=>indexing.requestRecovery(), dispose: () => {
          if (store instanceof EncryptedPrivateStore) store.dispose();
          else if(dependencies.privateIndexes) void (store as ReturnType<NonNullable<AppDependencies['privateIndexes']>>).dispose().catch(()=>console.error('Private storage cleanup will retry on the next worker sweep.'));
        } }; contexts.set(session, context);
      }
      context.recover();
      context.router(req, res, () => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Private workspace route not found.', retryable: false } }));
    } catch { res.status(503).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account verification is unavailable. Try again shortly.', retryable: true } }); }
  });
  return router;
}
