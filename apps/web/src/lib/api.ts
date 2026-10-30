export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-WhyCode-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body ? 220_000 : 20_000) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('whycode:unauthorized'));
  if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status}). Please retry.`);
  return data as T;
}
