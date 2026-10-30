import type { Health, Repository } from '../types/workspace';

type Request = <T>(path: string) => Promise<T>;
type Generation = { current: number };

/** The same generation is invalidated on scope changes, expiry and sign-out. */
export async function fetchWorkspace(request: Request, prefix: string, generation: Generation) {
  const version = ++generation.current;
  const [list, health] = await Promise.all([
    request<{ repositories: Repository[] }>(`${prefix}/repositories`),
    request<Health>(`${prefix}/health`),
  ]);
  return version === generation.current ? { repositories: list.repositories, health } : null;
}
