import { Router, type Request } from 'express';
import { z } from 'zod';
import { repositoryFromId, repositoryIdFor } from '../utils/repository.js';
import { IndexingService } from '../services/indexing-service.js';
import { QuestionService, QuestionServiceError } from '../services/question-service.js';
import type { AskResponse } from '../domain/question.js';

// Only English reasoning exists; hi and hinglish render the finished English answer via Sarvam.
const askInput = z.object({
  repositoryId: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(500),
  language: z.enum(['en', 'hi', 'hinglish']).optional(),
  includeExternalContext: z.boolean().optional(),
});

// Creates the /api/ask route while keeping its dependencies explicit and testable.
export function createAskRouter(questions: QuestionService, indexing: IndexingService, save?: (request: Request, answer: AskResponse) => boolean | Promise<boolean>): Router {
  const router = Router();

  // Answers one evidence-backed question about an indexed repository.
  router.post('/ask', async (request, response) => {
    const result = askInput.safeParse(request.body);

    if (!result.success) {
      response.status(400).json(errorResponse('VALIDATION_ERROR', 'Provide a repository ID and a question of at most 500 characters.'));
      return;
    }

    const repository = repositoryFromId(result.data.repositoryId);
    if (!repository) {
      response.status(400).json(errorResponse('INVALID_REPOSITORY', 'The repository ID is invalid.'));
      return;
    }

    let status;
    try { status=await indexing.getStatus(repositoryIdFor(repository)); }
    catch { response.status(503).json(errorResponse('STORAGE_UNAVAILABLE','Repository storage is temporarily unavailable.',true)); return; }
    if (!status) {
      response.status(404).json(errorResponse('INDEX_NOT_READY', 'This repository has not been indexed yet. Index it first, then ask.'));
      return;
    }

    if (status.status !== 'complete' && status.status !== 'partial') {
      response.status(409).json(errorResponse('INDEX_NOT_READY', 'Repository indexing has not completed. Wait for completion or retry a failed index.', true));
      return;
    }

    try {
      const answer = await questions.ask(repositoryIdFor(repository), result.data.question, {
        language: result.data.language,
        includeExternalContext: result.data.includeExternalContext,
      });
      if (save && !await save(request, answer)) answer.warnings.push('This answer could not be saved to your workspace.');
      response.json(answer);
    } catch (error) {
      if (error instanceof QuestionServiceError) {
        response.status(error.code === 'BUSY' ? 429 : 503).json({
          ...errorResponse(error.code, error.message, error.retryable),
          evidence: [],
        });
        return;
      }

      response.status(500).json(errorResponse('PROVIDER_UNAVAILABLE', 'Answering failed unexpectedly.', true));
    }
  });

  return router;
}

// Keeps API errors consistent with the documented error format.
function errorResponse(code: string, message: string, retryable = false) {
  return { error: { code, message, retryable } };
}
