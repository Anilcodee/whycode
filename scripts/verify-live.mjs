import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = process.env.WHYCODE_URL || 'http://localhost:4000';
const repository = 'octocat/hello-world';
const repositoryId = `github:${repository}`;
const repositoryPath = `/api/repositories/${encodeURIComponent(repositoryId)}`;
const report = { testedAt: new Date().toISOString(), repository, checks: [], timings: {} };
async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-WhyCode-Request': '1' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(220_000),
  });
  const result = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${result.error?.message ?? 'Request failed'}`);
  return result;
}
async function index() {
  const started = performance.now();
  await request('/api/repositories/ingest', { repository });
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await request(`${repositoryPath}/status`);
    if (status.status === 'failed') throw new Error(status.errors.join(' '));
    if (status.status === 'complete') {
      assert.equal(status.graph.status, 'written');
      return { counts: status.counts, graph: status.graph, durationMs: Math.round(performance.now() - started) };
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Indexing did not finish within 60 polling attempts.');
}
try {
  const health = await request('/api/health');
  assert.equal(health.dependencies.database, 'connected');
  report.checks.push('Neo4j connected');
  const first = await index();
  const second = await index();
  assert.deepEqual(first.counts, second.counts);
  assert.equal(second.graph.nodes, 0);
  assert.equal(second.graph.relationships, 0);
  report.indexing = { first, second };
  report.checks.push('Public repository indexed twice with stable counts and no duplicate graph entities or relationships');
  console.log('PASS: indexing and idempotence');

  let started = performance.now();
  const answer = await request('/api/ask', { repositoryId, question: 'What change introduced README and who authored it?' });
  report.timings.answerMs = Math.round(performance.now() - started);
  assert.equal(answer.abstained, false);
  assert.ok(answer.citedEvidenceIds.length > 0);
  assert.equal(answer.validation.status, 'reviewed');
  assert.ok(answer.validation.claims.every(claim => claim.quotes.length));
  assert.ok(answer.citedEvidenceIds.every(id => answer.evidence.some(card => card.id === id && card.url && card.author && card.date)));
  assert.match(answer.answer, /first commit|initial commit/i);
  report.answer = { text: answer.answer, citations: answer.citedEvidenceIds, confidence: answer.confidence.label, temporalStatus: answer.temporalStatus, model: answer.provider.model };
  report.checks.push('README introduction question returned an answer with source URL, author, date, and valid citations');
  console.log('PASS: cited answer');

  const graph = await request(`${repositoryPath}/graph?focus=${encodeURIComponent(answer.citedEvidenceIds[0])}`);
  assert.ok(graph.nodes.some(node => node.type === 'file'));
  assert.ok(graph.edges.some(edge => edge.type === 'CHANGED'));
  for (const type of ['file', 'person', 'repository']) {
    const node = graph.nodes.find(node => node.type === type);
    assert.ok(node, `${type} node missing`);
    const focused = await request(`${repositoryPath}/graph?focus=${encodeURIComponent(node.id)}`);
    assert.ok(focused.nodes.some(item => item.id === node.id), `${type} focus failed`);
  }
  report.checks.push('Commit, file, person, and repository graph focus returned connected nodes');
  console.log('PASS: relationship graph focus');

  started = performance.now();
  const unsupported = await request('/api/ask', { repositoryId, question: 'zxqvunsupportedfeature987' });
  report.timings.abstentionMs = Math.round(performance.now() - started);
  assert.equal(unsupported.abstained, true);
  assert.equal(unsupported.answer, null);
  report.checks.push('Unsupported question abstained');
  console.log('PASS: unsupported-question abstention');

  started = performance.now();
  const translated = await request('/api/ask', { repositoryId, question: 'What change introduced README and who authored it?', language: 'hinglish', includeExternalContext: true });
  report.timings.enhancedAnswerMs = Math.round(performance.now() - started);
  assert.equal(translated.abstained, false);
  assert.ok(translated.translatedAnswer, `Translation missing: ${translated.warnings.join(' ')}`);
  assert.ok(translated.externalContext?.length, `External context missing: ${translated.warnings.join(' ')}`);
  report.enhancements = { translatedAnswer: translated.translatedAnswer, webResults: translated.externalContext.length, warnings: translated.warnings };
  report.checks.push('Hinglish translation and separate web context returned successfully');
  console.log('PASS: translation and external context');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(new URL('../docs/live-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
