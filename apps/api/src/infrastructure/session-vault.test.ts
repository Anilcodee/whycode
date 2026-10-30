import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionVault } from './session-vault.js';

test('encrypted sessions survive reopening, deleted sessions stay deleted, and wrong keys fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'whycode-session-test-'));
  try {
    const key = randomBytes(32).toString('base64');
    const vault = new SessionVault<{ accessToken: string }>(directory, key);
    vault.save(new Map([['hashed-cookie', { accessToken: 'sensitive-test-token' }]]));
    assert.equal(readFileSync(join(directory, 'account-sessions.enc')).includes('sensitive-test-token'), false);
    const reopened = new SessionVault<{ accessToken: string }>(directory, key);
    assert.equal(reopened.load().get('hashed-cookie')?.accessToken, 'sensitive-test-token');
    assert.throws(() => new SessionVault(directory, randomBytes(32).toString('base64')).load(), /cannot be decrypted/);
    reopened.save(new Map());
    assert.equal(vault.load().size, 0);
    assert.throws(() => new SessionVault(directory, 'invalid'), /32 random bytes/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
