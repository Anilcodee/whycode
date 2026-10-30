import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EvidenceCard,
  decisionTimeline,
  questionTokens,
  temporalStatus,
  validCitations,
} from './question.js';
import {
  buildUserPrompt,
  extractJson,
  parseLlmAnswer,
} from './answer-prompt.js';

// Builds one evidence card with overrides for focused assertions.
function card(overrides: Partial<EvidenceCard> = {}): EvidenceCard {
  return {
    id: 'commit:abc',
    type: 'commit',
    title: 'Add retry limit',
    relationToAnswer: 'Commit matching the question',
    graphPath: ['commit:abc'],
    ...overrides,
  };
}

// Verifies tokenization drops stopwords, dedupes, keeps issue numbers, and stays bounded.
test('extracts bounded matching tokens from questions', () => {
  assert.deepEqual(questionTokens('Why does the client retry three times?'), ['client', 'retry', 'three', 'times']);
  assert.deepEqual(questionTokens('What happened with issue 42?'), ['issue', '42']);
  assert.deepEqual(questionTokens('the and or a of'), []);
  assert.equal(questionTokens('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu', 5).length, 5);
});

// Verifies invented citations are separated from real evidence citations.
test('validates citations against retrieved evidence', () => {
  const evidence = [card(), card({ id: 'pull:5', type: 'pull_request' })];
  const result = validCitations(['commit:abc', 'commit:fabricated', 'pull:5', 'pull:5'], evidence);

  assert.deepEqual(result.valid, ['commit:abc', 'pull:5']);
  assert.deepEqual(result.invalid, ['commit:fabricated']);
});

// Verifies temporal classification across current, superseded, and unresolved histories.
test('classifies temporal status from evidence dates', () => {
  const evidence = [
    card({ id: 'commit:old', date: '2026-01-01T00:00:00Z' }),
    card({ id: 'commit:new', date: '2026-06-01T00:00:00Z' }),
  ];

  assert.equal(temporalStatus(evidence, ['commit:new']), 'historical');
  assert.equal(temporalStatus(evidence, ['commit:old']), 'historical');
  assert.equal(
    temporalStatus([card({ id: 'issue:1', type: 'issue', state: 'open' })], ['issue:1']),
    'unresolved',
  );
  assert.equal(temporalStatus([card()], []), 'unresolved');
});

// Verifies the timeline is chronological regardless of retrieval order.
test('orders the decision timeline chronologically', () => {
  const timeline = decisionTimeline([
    card({ id: 'commit:new', date: '2026-06-01T00:00:00Z', title: 'Later' }),
    card({ id: 'commit:old', date: '2026-01-01T00:00:00Z', title: 'Earlier' }),
    card({ id: 'commit:nodate', title: 'Undated' }),
  ]);

  assert.deepEqual(timeline.map((entry) => entry.title), ['Earlier', 'Later']);
});

// Verifies the prompt carries evidence IDs, excerpts, and retrieval reasons for the model.
test('builds the answer prompt from evidence records', () => {
  const prompt = buildUserPrompt(
    'Why does the client retry three times?',
    [
      card({ excerpt: 'Retries prevent unbounded request growth.', date: '2026-01-01T00:00:00Z', author: 'octo' }),
      card({ id: 'pull:5', type: 'pull_request', title: 'Bounded retries' }),
    ],
    'Newer activity exists.',
  );

  assert.match(prompt, /Why does the client retry three times\?/);
  assert.match(prompt, /\[commit:abc\]/);
  assert.match(prompt, /\[pull:5\]/);
  assert.match(prompt, /Retries prevent unbounded request growth\./);
  assert.match(prompt, /Temporal context/);
});

// Verifies fenced or decorated model output still yields the JSON payload.
test('extracts JSON from model responses', () => {
  const fenced = '```json\n{"answer": "Because", "abstained": false, "confidence": "high", "confidenceReason": "r", "citedEvidenceIds": ["commit:abc"]}\n```';
  const parsed = parseLlmAnswer(extractJson(fenced));

  assert.equal(parsed.answer, 'Because');
  assert.equal(parsed.abstained, false);
  assert.deepEqual(parsed.citedEvidenceIds, ['commit:abc']);

  assert.throws(() => extractJson('no json here'));
  assert.throws(() => parseLlmAnswer({ wrong: 'shape' }));
});
