// Focused repository lifecycle test — rerun after rate-limit window resets.
const BASE = 'http://127.0.0.1:4000';
const jar = new Map();
const results = [];
let pass = 0, fail = 0;

async function req(method, path, body, attempt = 0) {
  const h = {};
  if (jar.size) h.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) { h['Content-Type'] = 'application/json'; h['X-WhyCode-Request'] = '1'; }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(300_000) });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';'); const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
    if (value === '' || /Expires=Thu, 01 Jan 1970/.test(sc)) jar.delete(name); else jar.set(name, value);
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  if (res.status === 503 && json?.error?.code === 'RATE_LIMIT_UNAVAILABLE' && attempt < 4) {
    await new Promise(r => setTimeout(r, 3000));
    return req(method, path, body, attempt + 1);
  }
  return { status: res.status, headers: res.headers, json, text };
}
function check(id, name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push({ id, name, ok, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 300)}`}`);
}

// T7.12 recheck (fixed harness)
{
  const priv = await req('GET', '/api/private/workspace/history');
  check('T7.12', 'private workspace without GitHub → 403 GITHUB_REQUIRED', priv.status === 403 && priv.json?.error?.code === 'GITHUB_REQUIRED', { status: priv.status, body: priv.json });
}
// T7.15 recheck with redirect:manual
{
  const cb = await req('GET', '/api/account/callback?flow=garbage&code=x');
  check('T7.15', 'callback garbage flow → 302 to ?account=failed', cb.status === 302 && (cb.headers.get('location') ?? '').includes('account=failed'), { status: cb.status, loc: cb.headers.get('location') });
}

// Repository lifecycle
const RID = encodeURIComponent('github:octocat/hello-world');
{
  // 1. validate
  const v = await req('POST', '/api/repositories/validate', { repository: 'octocat/Hello-World' });
  check('T9.1a', 'validate → 200 normalized', v.status === 200 && v.json?.repository === 'octocat/hello-world', v.json);

  // 2. ingest with retry on global RATE_LIMITED (window may still be cooling)
  let ing = await req('POST', '/api/repositories/ingest', { repository: 'octocat/Hello-World' });
  let waits = 0;
  while (ing.status === 429 && ing.json?.error?.code === 'RATE_LIMITED' && waits < 12) {
    console.log(`  ... ingest rate-limited, waiting 60s (attempt ${waits + 1})`);
    await new Promise(r => setTimeout(r, 60_000));
    ing = await req('POST', '/api/repositories/ingest', { repository: 'octocat/Hello-World' });
    waits++;
  }
  check('T9.1', 'ingest returns 202', ing.status === 202, { status: ing.status, body: ing.json });
  check('T9.2', 'ingest returns repositoryId+jobId+status', ing.json?.repositoryId === 'github:octocat/hello-world' && Boolean(ing.json?.jobId), ing.json);
  check('T9.3', 'ingest leaks no credentials', !/(token|secret|apikey|ghu_|ghp_)/i.test(ing.text), null);

  // 3. workspace list
  const list = await req('GET', '/api/repositories');
  check('T9.4', 'workspace list contains repo', Array.isArray(list.json?.repositories) && list.json.repositories.some(r => r.repositoryId === 'github:octocat/hello-world'), list.json);

  // 4. poll to terminal
  let status = null, attempts = 0;
  while (attempts < 120) {
    const s = await req('GET', `/api/repositories/${RID}/status`);
    if (s.status !== 200) { status = { httpError: s.status }; break; }
    status = s.json;
    if (['complete', 'partial', 'failed'].includes(status.status)) break;
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }
  check('T9.6', 'indexing reaches complete/partial', status && ['complete', 'partial'].includes(status.status), { final: status?.status ?? status, attempts });
  check('T9.7', 'counts numeric', status?.counts && Number.isFinite(status.counts.commits), status?.counts);
  console.log(`  ... final index status: ${status?.status} after ${attempts} polls; counts=${JSON.stringify(status?.counts)}`);

  // 5. graph
  const graph = await req('GET', `/api/repositories/${RID}/graph`);
  check('T9.8', 'graph → 200', graph.status === 200, { status: graph.status, body: graph.json });
  check('T9.9', 'graph nodes+edges arrays', Array.isArray(graph.json?.nodes) && Array.isArray(graph.json?.edges), { n: graph.json?.nodes?.length, e: graph.json?.edges?.length });
  // graph with focus param (injection probe)
  const gf = await req('GET', `/api/repositories/${RID}/graph?focus=${encodeURIComponent("') OR 1=1 //")}`);
  check('T9.9b', 'graph focus injection probe handled safely', [200, 400].includes(gf.status) && Array.isArray(gf.json?.nodes), { status: gf.status, nodes: gf.json?.nodes?.length });

  // 6. ask (real LLM)
  const t0 = Date.now();
  const ask = await req('POST', '/api/ask', { repositoryId: 'github:octocat/hello-world', question: 'What change introduced README and who authored it?' });
  const ms = Date.now() - t0;
  check('T9.10', 'ask → 200', ask.status === 200, { status: ask.status, body: ask.json });
  check('T9.11', 'ask shape: answer/abstained/evidence/warnings', typeof ask.json?.answer === 'string' && typeof ask.json?.abstained === 'boolean' && Array.isArray(ask.json?.evidence), { keys: Object.keys(ask.json ?? {}) });
  console.log(`  ... ask took ${(ms / 1000).toFixed(1)}s; abstained=${ask.json?.abstained}; evidence=${ask.json?.evidence?.length}; confidence=${JSON.stringify(ask.json?.confidence)}`);

  // 7. workspace history should now contain the answer
  const hist = await req('GET', '/api/workspace/history');
  check('T9.12', 'history contains the new answer', Array.isArray(hist.json?.history) && hist.json.history.length > 0, { n: hist.json?.history?.length });
  const item = hist.json?.history?.[0];

  // 8. remove answer from history
  if (item) {
    const rmh = await req('POST', '/api/workspace/history/remove', { repositoryId: item.repositoryId, answeredAt: item.answeredAt });
    check('T9.12b', 'history remove → 200', rmh.status === 200 && rmh.json?.removed === true, rmh.json);
    const hist2 = await req('GET', '/api/workspace/history');
    check('T9.12c', 'history empty after removal', hist2.json?.history?.length === 0, { n: hist2.json?.history?.length });
  }

  // 9. clear history endpoint
  const clr = await req('POST', '/api/workspace/history/clear', {});
  check('T9.12d', 'history clear → 200', clr.status === 200, clr.json);

  // 10. remove repository
  const rm = await req('POST', `/api/repositories/${RID}/remove`, {});
  check('T9.13', 'remove repo → 200', rm.status === 200, rm.json);
  const listAfter = await req('GET', '/api/repositories');
  check('T9.14', 'repo gone after remove', !listAfter.json?.repositories?.some(r => r.repositoryId === 'github:octocat/hello-world'), listAfter.json);
  const stAfter = await req('GET', `/api/repositories/${RID}/status`);
  check('T9.15', 'status after remove → 404', stAfter.status === 404, { status: stAfter.status });
  const askAfter = await req('POST', '/api/ask', { repositoryId: 'github:octocat/hello-world', question: 'test?' });
  check('T9.16', 'ask after remove → 404', askAfter.status === 404, { status: askAfter.status });
}

console.log(`\n==== LIFECYCLE RESULTS: ${pass} passed, ${fail} failed ====`);
const { writeFile } = await import('node:fs/promises');
await writeFile(new URL('./lifecycle-results.json', import.meta.url), JSON.stringify({ testedAt: new Date().toISOString(), pass, fail, results }, null, 2));
process.exit(fail > 0 ? 1 : 0);
