import type { Pool } from 'pg';

/** A reservation is charged even when the later provider call fails; no automatic refund. */
export class PostgresAnswerBudget {
  constructor(private readonly pool: Pick<Pool, 'query'>, private readonly namespace: string) {}
  async reserve(limit: number): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid answer budget');
    const result = await this.pool.query(`
      insert into whycode_runtime.answer_budget as budget (namespace, day, used)
      values ($1, (now() at time zone 'UTC')::date, 1)
      on conflict (namespace, day) do update set used = budget.used + 1
      where budget.used < $2 returning used`, [this.namespace, limit]);
    return result.rows.length === 1;
  }
}
