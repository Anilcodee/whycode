import { useCallback, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { api } from '../lib/api';
import { fetchWorkspace } from '../lib/workspace-loading';
import { isSavedAnswer } from '../lib/workspace-history';
import type { Answer, Health, Repository } from '../types/workspace';

type Setter<T> = Dispatch<SetStateAction<T>>;
type Options = {
  privateMode: boolean;
  userId?: string;
  githubLogin?: string;
  generation: RefObject<number>;
  loadedScope: RefObject<string>;
  hydrated: RefObject<boolean>;
  setRepositories: Setter<Repository[]>;
  setHealth: Setter<Health | null>;
  setHistory: Setter<Answer[]>;
  setSelected: Setter<string | null>;
  setAnswer: Setter<Answer | null>;
  setNotice: Setter<string>;
};

export function useWorkspaceLoading({ privateMode, userId, githubLogin, generation, loadedScope, hydrated,
  setRepositories, setHealth, setHistory, setSelected, setAnswer, setNotice }: Options) {
  return useCallback(async () => {
    const startingGeneration = generation.current;
    let history: Answer[] | undefined;
    let references: { repositoryId: string; repository: string }[] = [];
    if (!privateMode) {
      try {
        const saved = await api<{ history: unknown[]; repositories?: { repositoryId: string; repository: string }[]; warning?: string }>('/workspace/history');
        if (generation.current !== startingGeneration) return;
        history = Array.isArray(saved.history) ? saved.history.filter(isSavedAnswer) : [];
        references = Array.isArray(saved.repositories) ? saved.repositories : [];
        if (saved.warning) setNotice(saved.warning);
      } catch { setNotice('Temporary history could not be loaded. Please retry.'); }
    }
    const snapshot = await fetchWorkspace(api, privateMode ? '/private' : '', generation);
    if (!snapshot) return;
    const loadId = generation.current;
    setHealth(snapshot.health);
    if (!privateMode) {
      if (history) setHistory(history);
    } else if (userId) {
      try {
        const saved = await api<{ history: unknown[]; repositories?: { repositoryId: string; repository: string }[]; warning?: string }>('/private/workspace/history');
        if (generation.current !== loadId) return;
        setHistory(Array.isArray(saved.history) ? saved.history.filter(isSavedAnswer) : []);
        references = Array.isArray(saved.repositories) ? saved.repositories : [];
        if (saved.warning) setNotice(saved.warning);
      } catch { setNotice('Private history could not be loaded. Check your GitHub connection.'); }
    }
    const existing = new Set(snapshot.repositories.map(item => item.repositoryId));
    const missing: Repository[] = references.filter(item => typeof item.repositoryId === 'string' && typeof item.repository === 'string' && !existing.has(item.repositoryId)).map(item => ({
      ...item, jobId: '', status: 'failed', counts: { commits: 0, files: 0, pullRequests: 0, issues: 0, comments: 0, documents: 0 },
      progress: { phase: 'Reconnect to index', completed: 0, total: 6 }, warnings: [], errors: ['This repository needs to be indexed again in this session. Use the refresh button.'],
    }));
    setRepositories([...snapshot.repositories, ...missing]);
    loadedScope.current = privateMode ? 'private' : 'public';
    hydrated.current = true;
  }, [privateMode, userId, githubLogin, generation, loadedScope, hydrated,
    setRepositories, setHealth, setHistory, setSelected, setAnswer, setNotice]);
}
