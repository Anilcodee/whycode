import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWorkspace } from '../src/lib/workspace-loading';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('workspace loads repository and health records together in the requested scope', async () => {
  for (const prefix of ['', '/private']) {
    const paths: string[] = [];
    const list = deferred<unknown>();
    const health = deferred<unknown>();
    const request = <T>(path: string) => {
      paths.push(path);
      return (path.endsWith('/repositories') ? list.promise : health.promise) as Promise<T>;
    };
    const pending = fetchWorkspace(request, prefix, { current: 0 });
    assert.deepEqual(paths, [`${prefix}/repositories`, `${prefix}/health`]);
    list.resolve({ repositories: [] });
    health.resolve({ dependencies: { database: 'connected' } });
    assert.deepEqual(await pending, { repositories: [], health: { dependencies: { database: 'connected' } } });
  }
});

test('newer workspace loads suppress older responses arriving last', async () => {
  const generation = { current: 0 };
  const oldList = deferred<unknown>();
  const oldHealth = deferred<unknown>();
  const oldRequest = <T>(path: string) => (path.endsWith('/repositories') ? oldList.promise : oldHealth.promise) as Promise<T>;
  const old = fetchWorkspace(oldRequest, '', generation);
  const freshRequest = async <T>(path: string) => (path.endsWith('/repositories') ? { repositories: [] } : { dependencies: {} }) as T;
  assert.ok(await fetchWorkspace(freshRequest, '/private', generation));
  oldList.resolve({ repositories: [{ repositoryId: 'old' }] });
  oldHealth.resolve({ dependencies: {} });
  assert.equal(await old, null);
});

test('invalidating on sign-out or expiry prevents a pending workspace from returning', async () => {
  const generation = { current: 0 };
  const result = deferred<unknown>();
  const request = <T>() => result.promise as Promise<T>;
  const pending = fetchWorkspace(request, '', generation);
  generation.current++;
  result.resolve({ repositories: [], dependencies: {} });
  assert.equal(await pending, null);
});

test('partial request failure cannot yield a workspace snapshot', async () => {
  const request = async <T>(path: string) => {
    if (path.endsWith('/health')) throw new Error('Health unavailable');
    return { repositories: [] } as T;
  };
  await assert.rejects(fetchWorkspace(request, '', { current: 0 }), /Health unavailable/);
});
