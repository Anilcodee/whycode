import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestionService } from './question-service.js';
import { AnswerProviderResult } from '../domain/answer-prompt.js';
import { GraphReader } from '../infrastructure/graph/graph-reader.js';

const reader: GraphReader = {
  async resolveEntities() { return [{ kind: 'commit', key: 'commit:abc', title: 'Bound retries', score: 1 }]; },
  async collectEvidence() { return [{ kind: 'commit', id: 'commit:abc', title: 'Bound retries', relation: 'Matching commit', graphPath: ['commit:abc'] }]; },
  async getSubgraph() { return { nodes: [], edges: [] }; },
};
const base: AnswerProviderResult = {
  answer: 'Retries are bounded [commit:abc].', abstained: false,
  claims: [{ text: 'Retries are bounded [commit:abc].', evidenceIds: ['commit:abc'], quotes: [{ evidenceId: 'commit:abc', quote: 'Bound retries' }] }],
  confidence: 'high', confidenceReason: 'Explicit commit rationale.', citedEvidenceIds: ['commit:abc'],
};
for (const [name, overrides] of [
  ['missing citations', { answer: 'Retries are bounded.', citedEvidenceIds: [] }],
  ['invented citations', { citedEvidenceIds: ['commit:fake'] }],
  ['mixed valid and invented citations', { citedEvidenceIds: ['commit:abc', 'commit:fake'] }],
  ['empty answer', { answer: '  ' }],
  ['invented inline citations', { answer: 'Unverified claim [commit:fake].' }],
] as Array<[string, Partial<AnswerProviderResult>]>) {
  test(`abstains for ${name} while preserving inspectable evidence`, async () => {
    const service = new QuestionService(reader, { model: 'test', async generateAnswer() { return { ...base, ...overrides }; } });
    const result = await service.ask('github:owner/repo', 'Why bound retries?');
    assert.equal(result.abstained, true);
    assert.equal(result.answer, null);
    assert.equal(result.confidence.label, 'none');
    assert.equal(result.evidence.length, 1);
    assert.deepEqual(result.citedEvidenceIds, []);
  });
}
test('returns a cited answer when validation succeeds', async () => {
  const service = new QuestionService(reader, { model: 'test', async generateAnswer() { return base; }, async reviewAnswer() { return { supported: true, reason: 'Explicit rationale', temporalStatus: 'unresolved', temporalReason: 'No dated evidence', temporalEvidenceIds: ['commit:abc'] }; } });
  const result = await service.ask('github:owner/repo', 'Why bound retries?');
  assert.equal(result.abstained, false);
  assert.equal(result.answer, base.answer);
  assert.deepEqual(result.citedEvidenceIds, ['commit:abc']);
  assert.equal(result.temporalStatus, 'unresolved');
});
test('abstains without invoking a model when nothing matches', async () => {
  const service = new QuestionService({ ...reader, async resolveEntities() { return []; } });
  const result = await service.ask('github:owner/repo', 'Unknown subject');
  assert.equal(result.abstained, true);
  assert.match(result.abstentionReason!, /bounded index/);
});

test('withholds semantically unsupported claims even when quotation text matches', async () => {
  const service = new QuestionService(reader, { model: 'test', async generateAnswer() { return base; }, async reviewAnswer() { return { supported: false, reason: 'The quotation does not establish the claimed motivation.', temporalStatus: 'unresolved', temporalReason: '', temporalEvidenceIds: [] }; } });
  const result = await service.ask('github:owner/repo', 'Why retries?');
  assert.equal(result.abstained, true);
  assert.match(result.abstentionReason!, /motivation/);
});
test('withholds answers when independent review is unavailable', async () => {
  const service = new QuestionService(reader, { model: 'test', async generateAnswer() { return base; } });
  assert.equal((await service.ask('github:owner/repo', 'Why retries?')).abstained, true);
});
