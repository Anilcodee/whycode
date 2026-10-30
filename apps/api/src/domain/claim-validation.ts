import { EvidenceCard } from './question.js';
import { GroundedClaim, AnswerReview } from './answer-prompt.js';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export function validateClaims(claims: GroundedClaim[], evidence: EvidenceCard[]): string | undefined {
  if (!claims.length || claims.length > 4) return 'No bounded, source-grounded claims were returned.';
  const known = new Map(evidence.map(card => [card.id, card]));
  for (const claim of claims) {
    if (!claim.text.trim() || !claim.evidenceIds.length || !claim.quotes.length) return 'A claim has no source quotations.';
    const inlineIds = [...claim.text.matchAll(/\[((?:commit:|comment:|github:)[^\]\s]+)\]/g)].map(match => match[1]);
    if (inlineIds.some(id => !claim.evidenceIds.includes(id))) return 'A claim contains an undeclared citation.';
    for (const id of claim.evidenceIds) {
      if (!known.has(id) || !claim.quotes.some(quote => quote.evidenceId === id)) return 'A claim cites an unknown or unquoted source.';
    }
    for (const quote of claim.quotes) {
      const card = known.get(quote.evidenceId);
      if (!card || !claim.evidenceIds.includes(quote.evidenceId) || !normalize(quote.quote)) return 'A quotation has no matching source.';
      const fields = [card.title, card.excerpt, card.author, card.date].filter((value): value is string => Boolean(value));
      if (!fields.some(value => normalize(value).includes(normalize(quote.quote)))) return 'A supporting quotation does not occur in its cited source.';
    }
  }
}
export function validatedTemporalStatus(review: AnswerReview, evidence: EvidenceCard[]): AnswerReview['temporalStatus'] {
  const selected = evidence.filter(card => review.temporalEvidenceIds.includes(card.id));
  if (!selected.length || selected.length !== new Set(review.temporalEvidenceIds).size) return 'unresolved';
  if (review.temporalStatus === 'current') return selected.some(card => card.type === 'file' && card.current && card.revision) ? 'current' : 'historical';
  if (review.temporalStatus === 'superseded') {
    return selected.some(card => card.type === 'commit' && /\b(revert|reverted|supersede|superseded|replace|replaced|deprecat\w*)\b/i.test(`${card.title} ${card.excerpt ?? ''}`)) ? 'superseded' : 'historical';
  }
  return review.temporalStatus;
}
