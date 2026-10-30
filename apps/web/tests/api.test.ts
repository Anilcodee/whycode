import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from '../src/lib/api';

test('API preserves read/write requests and server error messages', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    assert.deepEqual(await api('/health'), { ok: true });
    await api('/questions', { question: 'Why?' });
    assert.equal(requests[0].url, '/api/health');
    assert.equal(requests[0].options?.method, 'GET');
    assert.equal(requests[1].options?.method, 'POST');
    assert.equal(requests[1].options?.credentials, 'same-origin');
    assert.equal((requests[1].options?.headers as Record<string, string>)['X-WhyCode-Request'], '1');
    assert.equal(requests[1].options?.body, JSON.stringify({ question: 'Why?' }));
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Index not ready' } }), { status: 409 });
    await assert.rejects(api('/questions'), /Index not ready/);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(api('/health'), /Request failed \(503\)/);
  } finally {
    globalThis.fetch = original;
  }
});
