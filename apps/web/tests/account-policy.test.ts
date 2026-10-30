import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountAccessChange, accountCallback } from '../src/lib/account-policy';
import type { Account } from '../src/types/account';

const connected: Account = {
  configured: true, providers: ['github'], user: { id: 'user', email: 'user@example.com' },
  github: { login: 'octocat' }, privateEnabled: true, installUrl: null,
};

test('loss of either account sign-in or GitHub access exits private mode and clears consent', () => {
  for (const account of [{ ...connected, user: null }, { ...connected, github: null }]) {
    assert.deepEqual(accountAccessChange(account, { required: false, authenticated: true }), { privateMode: false, clearConsent: true });
  }
});

test('connected accounts can enter a locked workspace privately without inheriting consent', () => {
  assert.deepEqual(accountAccessChange(connected, { required: true, authenticated: false }), { privateMode: true, clearConsent: false });
});

test('account refresh preserves explicit public/private selection for unlocked workspaces', () => {
  for (const session of [null, { required: false, authenticated: true }, { required: true, authenticated: true }]) {
    assert.deepEqual(accountAccessChange(connected, session), { privateMode: undefined, clearConsent: false });
  }
});

test('callback handling distinguishes failure, success and absent results', () => {
  assert.equal(accountCallback('?account=failed').notice, 'Sign-in was cancelled or could not be verified. Please retry.');
  assert.deepEqual(accountCallback('?account=connected'), { present: true, notice: undefined });
  assert.deepEqual(accountCallback('?unrelated=value'), { present: false, notice: undefined });
  assert.deepEqual(accountCallback('?account='), { present: false, notice: undefined });
});
