import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startRepositoryPolling } from '../src/lib/repository-polling';
import type { Repository } from '../src/types/workspace';

const status = (value: Repository['status']) => ({ status: value }) as Repository;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function clock() {
  const pending: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  return {
    pending,
    schedule(callback: () => void, delay: number) {
      const task = { callback, delay, cancelled: false };
      pending.push(task);
      return () => { task.cancelled = true; };
    },
    next() {
      const task = pending.shift();
      assert.ok(task);
      assert.equal(task.cancelled, false);
      task.callback();
    },
  };
}

test('polling waits for each response and stops on every terminal state', async () => {
  for (const terminal of ['complete', 'partial', 'failed'] as const) {
    const timer = clock();
    let calls = 0;
    const received: string[] = [];
    const stop = startRepositoryPolling({
      requestStatus: async () => status(++calls === 1 ? 'running' : terminal),
      onStatus: value => received.push(value.status), onError: () => {}, schedule: timer.schedule,
    });
    await flush();
    assert.equal(calls, 1);
    assert.equal(timer.pending[0].delay, 1500);
    timer.next();
    await flush();
    assert.deepEqual(received, ['running', terminal]);
    assert.equal(timer.pending.length, 0);
    stop();
  }
});

test('polling backs off within its cap and resets after a successful response', async () => {
  const timer = clock();
  let fail = true;
  const errors: string[] = [];
  const stop = startRepositoryPolling({
    requestStatus: async () => { if (fail) throw new Error('offline'); return status('running'); },
    onStatus: () => {}, onError: message => errors.push(message), schedule: timer.schedule,
  });
  await flush();
  for (const delay of [3000, 4500, 6000, 7500, 9000, 10000, 10000]) {
    assert.equal(timer.pending[0].delay, delay);
    timer.next();
    await flush();
  }
  fail = false;
  timer.next();
  await flush();
  assert.equal(timer.pending[0].delay, 1500);
  assert.equal(errors.at(-1), '');
  stop();
  assert.equal(timer.pending[0].cancelled, true);
});

test('disposing polling ignores late success and failure without scheduling more work', async () => {
  for (const reject of [false, true]) {
    const timer = clock();
    let resolve!: (value: Repository) => void;
    let fail!: (reason: Error) => void;
    let writes = 0;
    const stop = startRepositoryPolling({
      requestStatus: () => new Promise((yes, no) => { resolve = yes; fail = no; }),
      onStatus: () => { writes++; }, onError: () => { writes++; }, schedule: timer.schedule,
    });
    stop();
    if (reject) fail(new Error('late failure')); else resolve(status('running'));
    await flush();
    assert.equal(writes, 0);
    assert.equal(timer.pending.length, 0);
  }
});
