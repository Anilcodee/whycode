import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerView } from '../src/components/AnswerView';
import { SourceInspector } from '../src/components/SourceInspector';
import { EvidenceView } from '../src/components/EvidenceView';
import { TimelineView } from '../src/components/TimelineView';
import { date, richText, safeHref, SourceLink } from '../src/components/SourcePresentation';
import type { Answer, Evidence } from '../src/types/workspace';

const evidence: Evidence = {
  id: 'commit:abc', type: 'file', title: 'README', excerpt: '<script>alert(1)</script>\nreturn value;',
  url: 'https://github.com/example/repo/blob/abc/README#L12', revision: 'abcdef123456789',
  relationToAnswer: 'Introduced this file', graphPath: [],
};
const answer: Answer = {
  repositoryId: 'github:example/repo', question: 'Why?', answer: 'See [commit:abc] and `retry()`.',
  abstained: false, evidence: [evidence], citedEvidenceIds: [evidence.id],
  confidence: { label: 'supported', reason: 'Recorded in the source.' }, temporalStatus: 'historical',
  answeredAt: '2026-10-29T00:00:00Z', warnings: [], decisionTimeline: [],
};
const inspect = () => {};

test('evidence view preserves selected sources, citation badges and empty guidance', () => {
  const markup = renderToStaticMarkup(createElement(EvidenceView, { answer, inspectedId: evidence.id, onInspect: inspect }));
  assert.match(markup, /source-row inspected/);
  assert.match(markup, /id="source-commit%3Aabc"/);
  assert.match(markup, /CITED/);
  assert.match(markup, /\[1\]/);
  const empty = renderToStaticMarkup(createElement(EvidenceView, { answer: { ...answer, evidence: [] }, onInspect: inspect }));
  assert.match(empty, /No matching sources/);
});

test('timeline preserves supplied order and suppresses unsafe source URLs', () => {
  const timeline = [
    { evidenceId: 'a', title: 'Earlier change', date: '2026-01-01', type: 'commit', url: 'javascript:alert(1)' },
    { evidenceId: 'b', title: 'Later change', date: '2026-02-01', type: 'commit', url: evidence.url },
  ];
  const markup = renderToStaticMarkup(createElement(TimelineView, { timeline }));
  assert.ok(markup.indexOf('Earlier change') < markup.indexOf('Later change'));
  assert.doesNotMatch(markup, /javascript:/);
  const empty = renderToStaticMarkup(createElement(TimelineView, { timeline: [] }));
  assert.match(empty, /No dated history/);
});


test('citations preserve inspector targets and render untrusted prose as text', () => {
  const markup = renderToStaticMarkup(createElement('p', null, richText('<script> [commit:abc] `retry()` [unknown]', [evidence])));
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /data-source-id="commit:abc"/);
  assert.match(markup, /href="#source-inspector"/);
  assert.match(markup, />\[1\]<\/a>/);
  assert.match(markup, /<code>retry\(\)<\/code>/);
  assert.match(markup, /\[unknown\]/);
});

test('source links reject executable, credential-bearing and non-HTTPS destinations', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://user:password@example.com', '/local', undefined]) {
    assert.equal(safeHref(url), undefined);
    const markup = renderToStaticMarkup(createElement(SourceLink, { source: url, children: 'Source' }));
    assert.equal(markup, '<span>Source</span>');
  }
  const markup = renderToStaticMarkup(createElement(SourceLink, { source: evidence.url, children: 'Source' }));
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /target="_blank"/);
  assert.equal(date('invalid'), 'Undated');
});

test('source inspector retains selection, pinned revision, code line numbers and escaping', () => {
  const markup = renderToStaticMarkup(createElement(SourceInspector, {
    evidence: [evidence], source: evidence, onInspect: inspect, onClose: inspect,
  }));
  assert.match(markup, /id="source-inspector"/);
  assert.match(markup, /tabindex="-1"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /1 \/ 1/);
  assert.match(markup, /abcdef1234 · pinned revision/);
  assert.match(markup, /class="line-number" aria-hidden="true">12/);
  assert.match(markup, /class="line-number" aria-hidden="true">13/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test('source inspector explains absent sources and missing excerpts', () => {
  const empty = renderToStaticMarkup(createElement(SourceInspector, { evidence: [], onInspect: inspect, onClose: inspect }));
  assert.match(empty, /Your sources live here/);
  const missing = renderToStaticMarkup(createElement(SourceInspector, {
    evidence: [evidence], source: { ...evidence, excerpt: undefined }, onInspect: inspect, onClose: inspect,
  }));
  assert.match(missing, /No text excerpt is available/);
});

test('answer presentation retains citations, translated original and abstention states', () => {
  const render = (value: Answer) => renderToStaticMarkup(createElement(AnswerView, {
    answer: value, copied: false, onCopy: async () => {}, inspectSource: inspect,
  }));
  const normal = render(answer);
  assert.match(normal, /What the sources tell us/);
  assert.match(normal, /aria-label="Copy answer"/);
  assert.match(normal, /data-source-id="commit:abc"/);
  assert.match(normal, /Evidence checks/);
  const translated = render({ ...answer, translatedAnswer: 'Translated answer' });
  assert.match(translated, /Translated answer/);
  assert.match(translated, /Read the original English answer/);
  const withheld = render({ ...answer, answer: null, abstained: true, abstentionReason: 'No supporting records.' });
  assert.match(withheld, /The evidence stops here/);
  assert.match(withheld, /No supporting records/);
  assert.doesNotMatch(withheld, /aria-label="Copy answer"/);
});
