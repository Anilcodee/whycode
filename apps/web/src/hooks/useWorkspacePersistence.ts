import { useEffect, type RefObject } from 'react';
import { saveWorkspaceHistory } from '../lib/workspace-history';
import type { Answer } from '../types/workspace';

type Options = {
  privateMode: boolean;
  authenticated?: boolean;
  loadedScope: RefObject<string>;
  hydrated: RefObject<boolean>;
  selected: string | null;
  history: Answer[];
  onNotice: (message: string) => void;
};

export function useWorkspacePersistence({ privateMode, authenticated, loadedScope, hydrated, selected, history, onNotice }: Options) {
  useEffect(() => {
    if (privateMode || loadedScope.current !== 'public' || !authenticated || !hydrated.current) return;
    try { saveWorkspaceHistory(privateMode, selected, history); }
    catch { onNotice('Browser storage is unavailable. This investigation will remain available until you close the page.'); }
  }, [privateMode, authenticated, loadedScope, hydrated, selected, history, onNotice]);
}
