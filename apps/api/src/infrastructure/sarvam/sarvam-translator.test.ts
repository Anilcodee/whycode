import assert from 'node:assert/strict';
import test from 'node:test';
import { SarvamTranslator } from './sarvam-translator.js';

test('requests visible translation without reasoning and preserves citations', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    assert.equal(request.reasoning_effort, null);
    assert.equal(request.max_tokens, 2048);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Pehla commit [commit:abc].' } }] }));
  };
  try {
    assert.equal(await new SarvamTranslator('test', 'sarvam-105b').translate('First commit [commit:abc].', 'hinglish'), 'Pehla commit [commit:abc].');
  } finally { globalThis.fetch = original; }
});
for (const [name, choice] of [
  ['truncated', { finish_reason: 'length', message: { content: 'Partial text' } }],
  ['missing citation', { finish_reason: 'stop', message: { content: 'Pehla commit.' } }],
  ['invented citation', { finish_reason: 'stop', message: { content: 'Pehla commit [commit:fake].' } }],
] as const) {
  test(`rejects ${name} translation`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [choice] }));
    try { await assert.rejects(new SarvamTranslator('test', 'sarvam-105b').translate('First commit [commit:abc].', 'hi')); }
    finally { globalThis.fetch = original; }
  });
}
