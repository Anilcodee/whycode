import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClaims, validatedTemporalStatus } from './claim-validation.js';
import { AnswerReview, GroundedClaim } from './answer-prompt.js';
import { EvidenceCard } from './question.js';
const evidence: EvidenceCard[] = [{ id: 'commit:abc', type: 'commit', title: 'Bound retries', excerpt: 'Retry three times to avoid unbounded requests.', author: 'octo', relationToAnswer: 'Matching commit', graphPath: [] }];
const claim: GroundedClaim = { text: 'Retries are bounded [commit:abc].', evidenceIds: ['commit:abc'], quotes: [{ evidenceId: 'commit:abc', quote: 'avoid unbounded requests' }] };
test('accepts exact source quotations with normalized whitespace', () => assert.equal(validateClaims([claim], evidence), undefined));
test('rejects fabricated quotations and undeclared inline citations', () => {
  assert.ok(validateClaims([{ ...claim, quotes: [{ evidenceId: 'commit:abc', quote: 'The CEO required this.' }] }], evidence));
  assert.ok(validateClaims([{ ...claim, text: 'Claim [commit:fake]' }], evidence));
  assert.ok(validateClaims([], evidence));
});
test('rejects a cited source that has no quotation', () => assert.ok(validateClaims([{ ...claim, evidenceIds: ['commit:abc', 'commit:other'] }], evidence)));
const review: AnswerReview = { supported: true, reason: '', temporalStatus: 'current', temporalReason: '', temporalEvidenceIds: ['commit:abc'] };
test('dates alone cannot establish current or superseded decisions', () => {
  assert.equal(validatedTemporalStatus(review, evidence), 'historical');
  assert.equal(validatedTemporalStatus({ ...review, temporalStatus: 'superseded' }, evidence), 'historical');
});
test('current requires a pinned current code source; supersession requires reversal evidence', () => {
  assert.equal(validatedTemporalStatus(review, [{ ...evidence[0], type: 'file', current: true, revision: 'abc' }]), 'current');
  assert.equal(validatedTemporalStatus({ ...review, temporalStatus: 'superseded' }, [{ ...evidence[0], title: 'Revert bounded retries' }]), 'superseded');
});
