import type { Repository } from '../types/workspace';

export const isRepositoryTerminal = (repository: Pick<Repository, 'status'>) =>
  !['queued', 'running'].includes(repository.status);

type Options = {
  requestStatus: () => Promise<Repository>;
  onStatus: (status: Repository) => void;
  onError: (message: string) => void;
  schedule?: (callback: () => void, delay: number) => () => void;
};

/** One in-flight request at a time. Disposal ignores late responses and cancels retries. */
export function startRepositoryPolling({ requestStatus, onStatus, onError, schedule = defaultSchedule }: Options) {
  let cancelled = false;
  let failures = 0;
  let cancelTimer: (() => void) | undefined;

  async function poll() {
    try {
      const status = await requestStatus();
      if (cancelled) return;
      failures = 0;
      onError('');
      onStatus(status);
      if (isRepositoryTerminal(status)) return;
    } catch {
      if (cancelled) return;
      failures++;
      onError('Connection interrupted. Reconnecting automatically; indexing continues on the server.');
    }
    if (!cancelled) cancelTimer = schedule(() => { void poll(); }, Math.min(10_000, 1500 * (failures + 1)));
  }

  void poll();
  return () => { cancelled = true; cancelTimer?.(); };
}

function defaultSchedule(callback: () => void, delay: number) {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
}
