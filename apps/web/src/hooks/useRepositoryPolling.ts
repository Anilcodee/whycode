import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { api } from '../lib/api';
import { isRepositoryTerminal, startRepositoryPolling } from '../lib/repository-polling';
import type { Repository } from '../types/workspace';

export function useRepositoryPolling(
  repository: Repository | null,
  workspacePrefix: string,
  setRepositories: Dispatch<SetStateAction<Repository[]>>,
  setPollError: Dispatch<SetStateAction<string>>,
) {
  const id = repository?.repositoryId;
  const status = repository?.status;
  useEffect(() => {
    if (!id || !status || isRepositoryTerminal({ status })) return;
    return startRepositoryPolling({
      requestStatus: () => api<Repository>(`${workspacePrefix}/repositories/${encodeURIComponent(id)}/status`),
      onStatus: value => setRepositories(previous => previous.map(item => item.repositoryId === id ? value : item)),
      onError: setPollError,
    });
  }, [id, status, workspacePrefix, setRepositories, setPollError]);
}
