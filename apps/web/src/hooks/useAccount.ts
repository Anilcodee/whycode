import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '../lib/api';
import { accountAccessChange, accountCallback } from '../lib/account-policy';
import type { Account, WorkspaceSession } from '../types/account';

type Options = {
  session: WorkspaceSession | null;
  setPrivateMode: Dispatch<SetStateAction<boolean>>;
  setPrivateConsent: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useAccount({ session, setPrivateMode, setPrivateConsent, setNotice }: Options) {
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpenState] = useState(() => window.location.pathname === '/account');
  const setAccountOpen = useCallback((open: boolean) => {
    const target = open ? '/account' : '/workspace';
    if (window.location.pathname !== target) window.history.pushState(null, '', target);
    setAccountOpenState(open);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).get('account') === 'recovery');
  const requestVersion = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const refreshAccount = useCallback(async () => {
    const version = ++requestVersion.current;
    const next = await api<Account>('/account/session');
    if (version !== requestVersion.current) return;
    setAccount(next);
    const change = accountAccessChange(next, sessionRef.current);
    if (change.privateMode !== undefined) setPrivateMode(change.privateMode);
    if (change.clearConsent) setPrivateConsent(false);
  }, [setPrivateMode, setPrivateConsent]);

  useEffect(() => {
    void refreshAccount().catch(() => {});
    const callback = accountCallback(window.location.search);
    if (callback.present) {
      if (new URLSearchParams(window.location.search).get('account') === 'recovery') setRecovery(true);
      const result = new URLSearchParams(window.location.search).get('account');
      const showAccount = result === 'recovery' || result === 'failed';
      setAccountOpen(showAccount);
      if (callback.notice) setNotice(callback.notice);
      window.history.replaceState(null, '', showAccount ? '/account' : '/workspace');
    }
    // Prevent an older account request from restoring state after cleanup or session changes.
    return () => { requestVersion.current++; };
  }, [refreshAccount, setNotice, setAccountOpen]);

  useEffect(() => {
    const syncPage = () => setAccountOpenState(window.location.pathname === '/account');
    window.addEventListener('popstate', syncPage);
    return () => window.removeEventListener('popstate', syncPage);
  }, []);

  return { account, accountOpen, setAccountOpen, refreshAccount, recovery, setRecovery };
}
