// One evidence record shown with the answer, carrying its graph retrieval provenance.
export interface EvidenceCard {
  id: string;
  type: 'commit' | 'pull_request' | 'issue' | 'comment' | 'file' | 'document';
  revision?: string;
  current?: boolean;
  title: string;
  url?: string;
  date?: string;
  author?: string;
  state?: string;
  excerpt?: string;
  relationToAnswer: string;
  graphPath: string[];
}

// One chronological entry in the decision timeline returned with answers.
export interface TimelineEntry {
  evidenceId: string;
  type: EvidenceCard['type'];
  title: string;
  date?: string;
  url?: string;
}

// One generic web result in the clearly separated external context lane.
// These are never citations: they come from the public web, not the repository history.
export interface ExternalContextCard {
  title: string;
  url: string;
  snippet: string;
  source: 'web_search';
}

// Confidence label reported with every answer or abstention.
export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'none';

// Whether the cited evidence still reflects the current state of the code.
export type TemporalStatus = 'current' | 'historical' | 'superseded' | 'unresolved';

// Languages supported in the final rendered answer; English is the evidence language.
export type OutputLanguage = 'en' | 'hi' | 'hinglish';

// The full response shape returned by POST /api/ask per the API contract.
export interface AskResponse {
  repositoryId: string;
  question: string;
  answer: string | null;
  abstained: boolean;
  abstentionReason?: string;
  confidence: { label: ConfidenceLabel; reason: string };
  temporalStatus: TemporalStatus;
  evidence: EvidenceCard[];
  citedEvidenceIds: string[];
  decisionTimeline: TimelineEntry[];
  graphPath: string[];
  resolvedEntities: Array<{ kind: string; title: string }>;
  warnings: string[];
  provider?: { model: string };
  answeredAt: string;
  language: OutputLanguage;
  translatedAnswer?: string;
  validation?: { status: 'reviewed' | 'withheld'; reason: string; claims: Array<{ text: string; evidenceIds: string[]; quotes: Array<{ evidenceId: string; quote: string }> }> };
  temporalReason?: string;
  externalContext?: ExternalContextCard[];
}

// Breaks a question into bounded matching tokens, keeping pure numbers for issue references.
export function questionTokens(question: string, limit = 12): string[] {
  const stopWords = new Set([
    'why', 'is', 'the', 'this', 'code', 'does', 'do', 'did', 'what', 'when', 'how', 'and', 'for',
    'with', 'that', 'was', 'were', 'are', 'there', 'here', 'use', 'used', 'using', 'which', 'who',
    'not', 'can', 'could', 'should', 'would', 'will', 'just', 'about', 'into', 'over', 'than',
    'then', 'them', 'they', 'their', 'our', 'you', 'your', 'has', 'have', 'had', 'been', 'being',
    'from', 'like', 'made', 'make', 'wrote', 'write', 'written', 'happened', 'because', 'since',
  ]);

  const tokens: string[] = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9_./-]+/)) {
    const token = raw.trim();
    if (token.length < 3 && !/^\d+$/.test(token)) {
      continue;
    }
    if (stopWords.has(token) || tokens.includes(token)) {
      continue;
    }
    tokens.push(token);
    if (tokens.length >= limit) {
      break;
    }
  }

  return tokens;
}

// Splits citations into those backed by retrieved evidence and those the model invented.
export function validCitations(cited: string[], evidence: EvidenceCard[]): { valid: string[]; invalid: string[] } {
  const known = new Set(evidence.map((card) => card.id));
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const id of cited) {
    if (known.has(id) && !valid.includes(id)) {
      valid.push(id);
    } else if (!known.has(id)) {
      invalid.push(id);
    }
  }

  return { valid, invalid };
}

// Orders evidence chronologically so the interface can present the decision history.
export function decisionTimeline(evidence: EvidenceCard[]): TimelineEntry[] {
  return evidence
    .filter((card) => card.date !== undefined)
    .sort((left, right) => Date.parse(left.date ?? '') - Date.parse(right.date ?? ''))
    .map((card) => ({
      evidenceId: card.id,
      type: card.type,
      title: card.title,
      date: card.date,
      url: card.url,
    }));
}

// Classifies whether cited evidence reflects the current code or has since moved on.
export function temporalStatus(evidence: EvidenceCard[], citedIds: string[]): TemporalStatus {
  const relevant = citedIds.length > 0 ? evidence.filter((card) => citedIds.includes(card.id)) : evidence;

  if (relevant.some((card) => (card.type === 'issue' || card.type === 'pull_request') && card.state === 'open')) {
    return 'unresolved';
  }

  const citedDates = relevant.map((card) => card.date).filter((date): date is string => Boolean(date));

  if (citedDates.length === 0) {
    return 'unresolved';
  }

  // Dates establish chronology, not whether a decision still governs current code.
  return 'historical';
}
