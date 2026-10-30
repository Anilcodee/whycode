// One generic web result returned by the external context lane.
import { ExternalContextCard } from '../../domain/question.js';

export type { ExternalContextCard };

interface SerpApiResponse {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
}

// Failure that the question service converts into a visible warning, never a failed answer.
export class ExternalSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalSearchError';
  }
}

// Queries SerpAPI for generic web context that may accompany, but never replace, graph evidence.
export class SerpApiClient {
  constructor(private readonly apiKey: string) {}

  // Returns up to five web results for the repository and question, or throws ExternalSearchError.
  async searchContext(repository: string, question: string): Promise<ExternalContextCard[]> {
    const query = `${repository} ${question}`.slice(0, 300);
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('num', '5');
    url.searchParams.set('api_key', this.apiKey);

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(url, { signal: timeout.signal });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new ExternalSearchError(aborted ? 'The external search timed out.' : 'The external search could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ExternalSearchError(`The external search returned HTTP ${response.status}.${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }

    const body = (await response.json()) as SerpApiResponse;
    return (body.organic_results ?? [])
      .filter((result) => result.title && result.link)
      .slice(0, 5)
      .map((result) => ({
        title: result.title as string,
        url: result.link as string,
        snippet: (result.snippet ?? '').slice(0, 300),
        source: 'web_search' as const,
      }));
  }
}
