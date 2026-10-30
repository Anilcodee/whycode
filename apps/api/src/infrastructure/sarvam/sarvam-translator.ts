// The language layer only renders the finished English response in another language.
export type OutputLanguage = 'en' | 'hi' | 'hinglish';

interface SarvamChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
}

// Failure that the question service converts into a visible warning, never a failed answer.
export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationError';
  }
}

// Translates finished evidence-backed answers through Sarvam's chat API.
export class SarvamTranslator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  // Translates one finished answer, preserving citation tokens, URLs, and technical terms.
  async translate(text: string, language: Exclude<OutputLanguage, 'en'>): Promise<string> {
    const instruction = language === 'hi'
      ? 'Translate the user\'s text into Hindi (Devanagari script). Keep citation tokens like [commit:abc123] or [github:owner/repo:pull:42], URLs, file paths, and technical terms exactly unchanged. Return only the translation.'
      : 'Rewrite the user\'s text in Hinglish: Hindi written in Latin script, the way Indian developers chat. Keep citation tokens like [commit:abc123] or [github:owner/repo:pull:42], URLs, file paths, and technical terms exactly unchanged. Return only the rewritten text.';

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 25_000);

    let response: Response;
    try {
      response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: instruction },
            { role: 'user', content: text },
          ],
          temperature: 0.2,
          reasoning_effort: null,
          max_tokens: 2048,
        }),
        signal: timeout.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new TranslationError(aborted ? 'The language provider timed out.' : 'The language provider could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new TranslationError(`The language provider returned HTTP ${response.status}.${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }

    const body = (await response.json()) as SarvamChatResponse;
    if (body.choices?.[0]?.finish_reason === 'length') {
      throw new TranslationError('The language provider returned an incomplete translation.');
    }
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new TranslationError('The language provider returned an empty translation.');
    }

    const citations = (value: string) => [...new Set(value.match(/\[(?:commit:|comment:|github:)[^\]\s]+\]/g) ?? [])].sort();
    if (JSON.stringify(citations(text)) !== JSON.stringify(citations(content))) {
      throw new TranslationError('The translation changed source citation tokens; use the English answer.');
    }

    return content;
  }
}
