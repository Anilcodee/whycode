import type { AppConfig } from '../config.js';
import type { AccountSession } from '../services/account-service.js';
import type { AskResponse } from '../domain/question.js';

export type SavedInvestigation = AskResponse & { savedId: string };
type Row = { id: string; payload: AskResponse };
export type Visibility = 'public' | 'private';

/** Uses the verified user's token, never a service-role key; database RLS enforces ownership. */
export class AccountWorkspaceStore {
  constructor(private readonly config: AppConfig) {}
  private async request(session: AccountSession, query: string, method = 'GET', body?: unknown, resource = 'whycode_investigations', prefer?: string): Promise<unknown> {
    if (!this.config.accounts?.url.startsWith('https://')) throw new Error('WORKSPACE_UNAVAILABLE');
    const response = await fetch(`${this.config.accounts.url}/rest/v1/${resource}${query}`, {
      method,
      headers: { apikey: this.config.accounts.key, Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json', Prefer: prefer ?? (method === 'POST' ? 'return=representation' : 'return=minimal') },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('WORKSPACE_UNAVAILABLE');
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
  async list(session: AccountSession, visibility: Visibility): Promise<SavedInvestigation[]> {
    const query = new URLSearchParams({ select: 'id,payload', visibility: `eq.${visibility}`, order: 'answered_at.desc', limit: '100' });
    const rows = await this.request(session, `?${query}`) as Row[];
    if (!Array.isArray(rows)) throw new Error('WORKSPACE_UNAVAILABLE');
    return rows.map(row => ({ ...row.payload, savedId: row.id }));
  }
  async save(session: AccountSession, visibility: Visibility, answer: AskResponse): Promise<string> {
    const rows = await this.request(session, '?select=id', 'POST', {
      repository_id: answer.repositoryId, visibility, answered_at: answer.answeredAt, payload: answer,
    }) as { id: string }[];
    if (!rows?.[0]?.id) throw new Error('WORKSPACE_UNAVAILABLE');
    return rows[0].id;
  }
  async remove(session: AccountSession, id: string): Promise<void> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('INVALID_ID');
    const rows = await this.request(session, `?${new URLSearchParams({ id: `eq.${id}`, select: 'id' })}`, 'DELETE', undefined, 'whycode_investigations', 'return=representation') as { id: string }[];
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('NOT_FOUND');
  }
  async clear(session: AccountSession, visibility: Visibility): Promise<void> {
    await this.request(session, `?${new URLSearchParams({ visibility: `eq.${visibility}` })}`, 'DELETE');
  }
  async removeRepository(session: AccountSession, visibility: Visibility, repositoryId: string): Promise<void> {
    await this.request(session, '', 'POST', { p_visibility: visibility, p_repository_id: repositoryId }, 'rpc/whycode_remove_repository', 'return=minimal');
  }
  async listRepositories(session: AccountSession, visibility: Visibility): Promise<{ repositoryId: string; repository: string }[]> {
    const query = new URLSearchParams({ select: 'repository_id,repository', visibility: `eq.${visibility}`, order: 'created_at.desc', limit: '100' });
    const rows = await this.request(session, `?${query}`, 'GET', undefined, 'whycode_repositories') as { repository_id: string; repository: string }[];
    if (!Array.isArray(rows)) throw new Error('WORKSPACE_UNAVAILABLE');
    return rows.map(row => ({ repositoryId: row.repository_id, repository: row.repository }));
  }
  async addRepository(session: AccountSession, visibility: Visibility, repositoryId: string, repository: string): Promise<void> {
    await this.request(session, '?on_conflict=user_id,repository_id,visibility', 'POST', { repository_id: repositoryId, repository, visibility }, 'whycode_repositories', 'resolution=merge-duplicates,return=minimal');
  }
}
