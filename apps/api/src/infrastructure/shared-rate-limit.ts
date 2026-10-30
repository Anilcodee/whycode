import { createHash } from 'node:crypto';

export type SharedLimitConfig = { url: string; token: string; namespace: string };
const health=new WeakMap<SharedLimitConfig,string>();
export function sharedRateLimitHealth(config?:SharedLimitConfig) { return config?(health.get(config)??'not_checked'):'local'; }
// The first increment and expiry are atomic, including simultaneous calls from replicas.
const increment = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

export async function sharedRateLimit(config: SharedLimitConfig, scope: string, identity: string, windowMs: number) {
  try { const result=await consume(config,scope,identity,windowMs);health.set(config,'connected');return result; }
  catch {health.set(config,'unreachable');throw new Error('RATE_LIMIT_STORE_UNAVAILABLE');}
}
async function consume(config: SharedLimitConfig, scope: string, identity: string, windowMs: number) {
  const identityHash = createHash('sha256').update(identity).digest('hex');
  const key = `${config.namespace}:limit:${scope}:${identityHash}`;
  let response:Response|undefined;
  for(let attempt=0;attempt<2;attempt++) {
    try {
    response = await fetch(config.url, {
    method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', increment, '1', key, String(windowMs)]), signal: AbortSignal.timeout(3000),
    });
    if(response.ok || response.status<500)break;
    await response.body?.cancel();
    } catch { if(attempt===1)throw new Error('RATE_LIMIT_STORE_UNAVAILABLE'); }
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!response)throw new Error('RATE_LIMIT_STORE_UNAVAILABLE');
  if (!response.ok) throw new Error('RATE_LIMIT_STORE_UNAVAILABLE');
  const result = await response.json() as { result?: unknown; error?: string };
  const values = result.result;
  if (result.error || !Array.isArray(values) || values.length !== 2 ||
    !Number.isSafeInteger(values[0]) || values[0] < 1 || !Number.isSafeInteger(values[1]) || values[1] < 0) {
    throw new Error('RATE_LIMIT_STORE_UNAVAILABLE');
  }
  return { count: values[0] as number, retryAfter: Math.max(1, Math.ceil(values[1] / 1000)) };
}
