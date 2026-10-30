import type { Account, WorkspaceSession } from '../types/account';

/** Account sign-in and GitHub authorization remain separate requirements. */
export function accountAccessChange(account: Account, session: WorkspaceSession | null) {
  if (!account.user || !account.github) return { privateMode: false, clearConsent: true };
  if (session?.required && !session.authenticated) return { privateMode: true, clearConsent: false };
  return { privateMode: undefined, clearConsent: false };
}

export function accountCallback(search: string) {
  const result = new URLSearchParams(search).get('account');
  return {
    present: Boolean(result),
    notice: result === 'failed' ? 'Sign-in was cancelled or could not be verified. Please retry.' : undefined,
  };
}
