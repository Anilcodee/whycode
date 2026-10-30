// Canonical, path-safe identities prevent query/path injection and case aliases.
export function normalizeRepository(value: string): string | null {
  const trimmed = value.trim().replace(/\/$/, '').replace(/\.git$/i, '');
  const candidate = trimmed.replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
  const match = candidate.match(/^([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9_.-]{1,100})$/i);
  if (!match || match[2] === '.' || match[2] === '..') return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}
export function repositoryFromId(id: string): string | null {
  try { return normalizeRepository(decodeURIComponent(id).replace(/^github:/, '')); }
  catch { return null; }
}
export function repositoryIdFor(repository: string): string { return `github:${repository.toLowerCase()}`; }
