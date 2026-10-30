import { AnswerProvider } from '../domain/answer-prompt.js';
import { AskResponse, EvidenceCard, ExternalContextCard, OutputLanguage, decisionTimeline, questionTokens, validCitations } from '../domain/question.js';
import { validateClaims, validatedTemporalStatus } from '../domain/claim-validation.js';
import { GraphReader } from '../infrastructure/graph/graph-reader.js';
import { SarvamTranslator } from '../infrastructure/sarvam/sarvam-translator.js';
import { SerpApiClient } from '../infrastructure/search/serpapi-client.js';

export class QuestionServiceError extends Error {
  constructor(readonly code: 'DATABASE_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' | 'BUSY', message: string, readonly retryable: boolean) { super(message); this.name = 'QuestionServiceError'; }
}
export interface AskOptions { language?: OutputLanguage; includeExternalContext?: boolean }
export class QuestionService {
  private static active = 0;
  constructor(private readonly reader: GraphReader, private readonly provider?: AnswerProvider,
    private readonly translator?: SarvamTranslator, private readonly search?: SerpApiClient) {}
  async ask(repositoryId: string, question: string, options: AskOptions = {}): Promise<AskResponse> {
    if (QuestionService.active >= 2) throw new QuestionServiceError('BUSY', 'Two investigations are already running. Please wait and retry.', true);
    QuestionService.active++;
    try { return await this.execute(repositoryId, question, options); }
    finally { QuestionService.active--; }
  }
  private async execute(repositoryId: string, question: string, options: AskOptions): Promise<AskResponse> {
    const language = options.language ?? 'en';
    const warnings: string[] = ['Answers cover the indexed history window and pinned source revision, not every branch or every commit.'];
    let entities, records;
    try {
      entities = await this.reader.resolveEntities(repositoryId, questionTokens(question));
      records = entities.length ? await this.reader.collectEvidence(repositoryId, entities) : [];
    } catch { throw new QuestionServiceError('DATABASE_UNAVAILABLE', 'Repository evidence is temporarily unavailable. Check the database connection and retry.', true); }
    const evidence: EvidenceCard[] = records.map(record => ({
      id: record.id, type: record.kind, title: record.title, url: record.url, date: record.date,
      author: record.author, state: record.state, excerpt: record.excerpt, graphPath: record.graphPath,
      relationToAnswer: record.relation, revision: record.revision, current: record.current,
    }));
    const base: AskResponse = { repositoryId, question, language, evidence, resolvedEntities: entities.map(item => ({ kind: item.kind, title: item.title })),
      answer: null, abstained: true, confidence: { label: 'none', reason: '' }, temporalStatus: 'unresolved',
      decisionTimeline: decisionTimeline(evidence), graphPath: [], citedEvidenceIds: [], warnings, answeredAt: new Date().toISOString() };
    const abstain = async (reason: string) => this.finalize({ ...base, abstentionReason: reason,
      confidence: { label: 'none', reason }, validation: { status: 'withheld', reason, claims: [] } }, options);
    if (!evidence.length) return abstain('The bounded index has no matching evidence. Name a file, function, issue number, or commit to narrow the question.');
    if (!this.provider) throw new QuestionServiceError('PROVIDER_UNAVAILABLE', 'Configure an answer provider on the server to enable explanations.', false);
    let candidate;
    try { candidate = await this.provider.generateAnswer({ question, evidence }); }
    catch { throw new QuestionServiceError('PROVIDER_UNAVAILABLE', 'The answer provider is unavailable or returned an incomplete response. Please retry.', true); }
    if (candidate.abstained) return abstain(candidate.answer || 'The records do not establish the rationale.');
    const inline = [...candidate.answer.matchAll(/\[((?:commit:|comment:|github:)[^\]\s]+)\]/g)].map(match => match[1]);
    const citations = validCitations([...candidate.citedEvidenceIds, ...inline], evidence);
    const claims = candidate.claims ?? [];
    const invalid = validateClaims(claims, evidence);
    if (!candidate.answer.trim() || !citations.valid.length || citations.invalid.length || invalid) return abstain(invalid ?? 'The answer contains missing or unverifiable citations.');
    if (!this.provider.reviewAnswer) return abstain('Independent evidence review is unavailable; the explanation was withheld.');
    let review;
    try { review = await this.provider.reviewAnswer({ question, evidence, claims }); }
    catch { return abstain('The evidence review could not finish. The unreviewed explanation was withheld; please retry.'); }
    if (!review.supported) return abstain(`Evidence review withheld this explanation: ${review.reason}`);
    const ids = [...new Set(claims.flatMap(claim => claim.evidenceIds))];
    // Render only reviewed atomic claims; discard unreviewed model prose.
    const answer = claims.map(claim => {
      const missing = claim.evidenceIds.filter(id => !claim.text.includes(`[${id}]`));
      return `${claim.text}${missing.length ? ` ${missing.map(id => `[${id}]`).join(' ')}` : ''}`;
    }).join('\n\n');
    const temporalStatus = validatedTemporalStatus(review, evidence);
    const ordered = [...evidence.filter(card => ids.includes(card.id)), ...evidence.filter(card => !ids.includes(card.id))];
    return this.finalize({ ...base, answer, abstained: false, evidence: ordered, citedEvidenceIds: ids,
      confidence: { label: candidate.confidence === 'high' ? 'medium' : candidate.confidence === 'none' ? 'low' : candidate.confidence,
        reason: 'Source quotations match and a separate model pass reviewed every claim. This is a model assessment; inspect the primary sources.' },
      validation: { status: 'reviewed', reason: review.reason, claims },
      temporalStatus, temporalReason: temporalStatus === review.temporalStatus ? review.temporalReason : 'The records do not establish the proposed temporal classification; a conservative status is shown.',
      graphPath: evidence.filter(card => ids.includes(card.id)).flatMap(card => card.graphPath).filter((step, index, all) => all.indexOf(step) === index).slice(0, 12),
      provider: { model: candidate.model ?? this.provider.model }, answeredAt: new Date().toISOString(),
    }, options);
  }
  private async finalize(response: AskResponse, options: AskOptions): Promise<AskResponse> {
    const warnings = [...response.warnings];
    let externalContext: ExternalContextCard[] | undefined;
    let translatedAnswer: string | undefined;
    await Promise.all([
      (async () => {
        if (!options.includeExternalContext) return;
        if (!this.search) { warnings.push('Web context is not configured. Repository evidence is still available.'); return; }
        try { externalContext = await this.search.searchContext(response.repositoryId.replace(/^github:/, ''), response.question); }
        catch { warnings.push('Web context is unavailable. The repository answer is unchanged.'); }
      })(),
      (async () => {
        if (!options.language || options.language === 'en') return;
        if (!this.translator) { warnings.push('Translation is not configured. The English answer is shown.'); return; }
        try { translatedAnswer = await this.translator.translate(response.answer ?? response.abstentionReason ?? '', options.language); }
        catch { warnings.push('Translation is unavailable or did not preserve citations. The English answer is shown.'); }
      })(),
    ]);
    return { ...response, warnings, externalContext, translatedAnswer };
  }
}
