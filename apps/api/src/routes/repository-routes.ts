import { Router, type Request } from 'express';
import { z } from 'zod';
import { DEFAULT_INDEX_LIMITS, IndexLimits } from '../domain/indexing.js';
import { GraphReader } from '../infrastructure/graph/graph-reader.js';
import { IndexingService } from '../services/indexing-service.js';
import { normalizeRepository, repositoryFromId } from '../utils/repository.js';

const repositoryInput = z.object({
  repository: z.string().trim().min(1).max(200),
});

const ingestInput = repositoryInput.extend({
  append: z.boolean().optional(),
  limits: z.object({
    commits: z.number().int().min(0).max(500).optional(),
    pullRequests: z.number().int().min(0).max(500).optional(),
    issues: z.number().int().min(0).max(500).optional(),
    comments: z.number().int().min(0).max(1_000).optional(),
  }).optional(),
});

// Creates repository routes while keeping the service dependency explicit and testable.
type WorkspaceScope = { includes: (request: Request, id: string) => boolean; add: (request: Request, id: string) => void; remove: (request: Request, id: string) => boolean };
export function createRepositoryRouter(indexing: IndexingService, reader?: GraphReader, workspace?: WorkspaceScope, onConnect?: (request: Request, repositoryId: string, repository: string) => Promise<void>): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    try { response.json({ repositories: (await indexing.listStatuses()).filter(item => !workspace || workspace.includes(request, item.repositoryId)) }); }
    catch { response.status(503).json(errorResponse('STORAGE_UNAVAILABLE','Repository storage is temporarily unavailable.')); }
  });

  // Validates and normalizes a repository before any indexing work begins.
  router.post('/validate', (request, response) => {
    const result = repositoryInput.safeParse(request.body);

    if (!result.success) {
      response.status(400).json(errorResponse('VALIDATION_ERROR', 'Enter a GitHub repository as owner/repository or a GitHub URL.'));
      return;
    }

    const normalized = normalizeRepository(result.data.repository);
    if (!normalized) {
      response.status(400).json(errorResponse('INVALID_REPOSITORY', 'Enter a valid public GitHub repository.'));
      return;
    }

    response.json({ repository: normalized, status: 'ready_for_indexing' });
  });

  // Starts bounded asynchronous indexing and returns immediately with a polling handle.
  router.post('/ingest', async (request, response) => {
    const result = ingestInput.safeParse(request.body);

    if (!result.success) {
      response.status(400).json(errorResponse('VALIDATION_ERROR', 'Provide a valid repository and optional numeric indexing limits.'));
      return;
    }

    const repository = normalizeRepository(result.data.repository);
    if (!repository) {
      response.status(400).json(errorResponse('INVALID_REPOSITORY', 'Enter a valid public GitHub repository.'));
      return;
    }

    let status;
    try { status = await indexing.start(repository, mergeLimits(result.data.limits), result.data.append); }
    catch (error) {
      if (error instanceof Error && error.message === 'HISTORY_LIMIT') {
        response.status(409).json(errorResponse('HISTORY_LIMIT', 'No continuation is available, or this index reached its 5,000-commit safety limit. Refresh to start a new window.')); return;
      }
      if (!(error instanceof Error) || !['INDEX_BUSY','WORKSPACE_FULL'].includes(error.message)) { response.status(503).json(errorResponse('STORAGE_UNAVAILABLE','Repository storage is temporarily unavailable.')); return; }
      response.status(429).json(errorResponse('INDEX_BUSY', error instanceof Error && error.message === 'WORKSPACE_FULL' ? 'This workspace has reached its 30-repository storage limit.' : 'Two repositories are already indexing. Please wait before starting another.'));
      return;
    }
    workspace?.add(request, status.repositoryId);
    let workspaceWarning: string | undefined;
    if (onConnect) try { await onConnect(request, status.repositoryId, repository); }
    catch { workspaceWarning = 'Account storage is unavailable; this repository is temporary.'; }
    response.status(202).json({
      repositoryId: status.repositoryId,
      jobId: status.jobId,
      status: status.status,
      ...(workspaceWarning ? { workspaceWarning } : {}),
    });
  });

  // Returns the current status for a repository while indexing runs in the background.
  router.get('/:repositoryId/status', async (request, response) => {
    const repository = repositoryFromId(request.params.repositoryId);
    if (!repository) {
      response.status(400).json(errorResponse('INVALID_REPOSITORY', 'The repository status ID is invalid.'));
      return;
    }

    let status;
    try { status=await indexing.getStatus(`github:${repository}`); }
    catch { response.status(503).json(errorResponse('STORAGE_UNAVAILABLE','Repository storage is temporarily unavailable.')); return; }
    if (workspace && !workspace.includes(request, `github:${repository}`)) {
      response.status(404).json(errorResponse('INDEX_NOT_READY', 'This repository is not in your workspace.')); return;
    }
    if (!status) {
      response.status(404).json(errorResponse('INDEX_NOT_READY', 'This repository has not been indexed yet.'));
      return;
    }

    response.json(status);
  });

  // Returns a bounded subgraph for the relationship view, focused on one entity when given.
  router.get('/:repositoryId/graph', async (request, response) => {
    const repository = repositoryFromId(request.params.repositoryId);
    if (!repository) {
      response.status(400).json(errorResponse('INVALID_REPOSITORY', 'The repository ID is invalid.'));
      return;
    }

    if (!reader) {
      response.status(503).json(errorResponse('DATABASE_UNAVAILABLE', 'Graph storage is not configured, so no relationship view is available.'));
      return;
    }

    if (workspace && !workspace.includes(request, `github:${repository}`)) {
      response.status(404).json(errorResponse('INDEX_NOT_READY', 'This repository is not in your workspace.')); return;
    }

    let indexed;
    try { indexed=await indexing.getStatus(`github:${repository}`); }
    catch { response.status(503).json(errorResponse('STORAGE_UNAVAILABLE','Repository storage is temporarily unavailable.')); return; }
    if (!indexed) {
      response.status(404).json(errorResponse('INDEX_NOT_READY', 'This repository has not been indexed yet.'));
      return;
    }

    const focus = typeof request.query.focus === 'string' ? request.query.focus.slice(0, 300) : undefined;

    try {
      const subgraph = await reader.getSubgraph(`github:${repository}`, focus);
      response.json(subgraph);
    } catch (error) {
      response.status(503).json(errorResponse(
        'DATABASE_UNAVAILABLE',
        'The graph database is unavailable. Check the server connection and retry.',
      ));
    }
  });

  if (workspace) router.post('/:repositoryId/remove', (request, response) => {
    const repository = repositoryFromId(request.params.repositoryId);
    if (!repository || !workspace.remove(request, `github:${repository}`)) {
      response.status(404).json(errorResponse('NOT_FOUND', 'This repository is not in your workspace.')); return;
    }
    response.json({ removed: true });
  });
  return router;
}

// Applies only caller-provided limits while retaining safe defaults for omitted values.
function mergeLimits(limits: Partial<IndexLimits> | undefined): IndexLimits {
  return { ...DEFAULT_INDEX_LIMITS, ...limits };
}

// Keeps API errors consistent across validation and indexing routes.
function errorResponse(code: string, message: string) {
  return { error: { code, message, retryable: false } };
}
