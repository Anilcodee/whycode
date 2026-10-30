// Real storage checks use a temporary namespace and fabricated repository/session data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import dotenv from 'dotenv';
import {createPostgresPool} from '../apps/api/src/infrastructure/postgres.ts';
import {CentralIndexStore} from '../apps/api/src/infrastructure/indexing/central-index-store.ts';
import {SharedSessions} from '../apps/api/src/infrastructure/shared-sessions.ts';
import {IndexingService} from '../apps/api/src/services/indexing-service.ts';
import {Neo4jConnection} from '../apps/api/src/infrastructure/graph/neo4j-connection.ts';
import {Neo4jGraphStore} from '../apps/api/src/infrastructure/graph/neo4j-graph-store.ts';
const env=dotenv.parse(readFileSync('.env')),ns=`worker-check-${randomUUID()}`;
const pools=[0,1].map(()=>createPostgresPool(env.DATABASE_URL,env.DATABASE_SSL_CA_FILE));
const stores=pools.map(p=>new CentralIndexStore(p,ns));
const counts={commits:0,files:0,pullRequests:0,issues:0,comments:0,documents:0};
const status=id=>({repositoryId:`github:test/${id}`,repository:`test/${id}`,jobId:randomUUID(),status:'queued',startedAt:new Date().toISOString(),counts,progress:{phase:'Queued',completed:0,total:6},warnings:[],errors:[],request:{limits:{commits:25,pullRequests:0,issues:0,comments:0},append:false,recoveries:0}});
const snapshot=s=>({repositoryId:s.repositoryId,repository:s.repository,fullName:s.repository,repositoryUrl:'https://github.com/'+s.repository,defaultBranch:'main',indexedAt:new Date().toISOString(),counts,commits:[],files:[],commitFiles:[],pullRequests:[],issues:[],comments:[]});
let neo4j;let graphId;
try {
  const jobs=Array.from({length:8},(_,i)=>status(`slots-${i}`));
  const admitted=await Promise.all(jobs.map((job,i)=>stores[i%2].claimJob(job)));
  assert.equal(admitted.filter(Boolean).length,2);
  for(let i=0;i<jobs.length;i++)if(admitted[i])await stores[0].saveStatus({...jobs[i],status:'complete'});
  const sessions=new SharedSessions(pools[0],ns,env.SESSION_ENCRYPTION_KEY);
  const session={user:{id:'mock-private-user',email:'mock@example.com'},accessToken:'mock-access',github:{token:'mock-github',login:'mock',expires:Date.now()+60000},expires:Date.now()+60000};
  await sessions.create('mock-cookie-hash',session);
  const scope=createHash('sha256').update(session.user.id+':'+session.accessToken+':'+session.github.token).digest('hex');
  const privateStores=pools.map(p=>new CentralIndexStore(p,ns,{id:scope,expires:session.expires,key:env.SESSION_ENCRYPTION_KEY}));
  const legacyStatus={...status('legacy'),status:'complete'},legacySnapshot=snapshot(legacyStatus);
  const legacy={listStatuses:()=>[legacyStatus],getSnapshot:()=>legacySnapshot};
  await privateStores[0].importLegacy(legacy,'legacy-fixture');
  assert.ok(await privateStores[1].getSnapshot(legacyStatus.repositoryId));
  await privateStores[1].removeRepository(legacyStatus.repositoryId);
  await privateStores[0].importLegacy(legacy,'legacy-fixture');
  assert.equal(await privateStores[1].getSnapshot(legacyStatus.repositoryId),undefined);
  const privateJob=status('private');assert.ok(await privateStores[0].claimJob(privateJob));
  const mixed=status('mixed-public');assert.ok(await stores[0].claimJob(mixed));
  assert.equal(await stores[1].claimJob(status('mixed-overflow')),false);
  assert.equal(await privateStores[1].claimJob(status('mixed-private-overflow')),false);
  await stores[0].saveStatus({...mixed,status:'complete'});
  const privateSnapshot={...snapshot(privateJob),sources:[{kind:'file',path:'secret.txt',content:'fabricated-sensitive-content',revision:'test'}]};
  await privateStores[0].saveSnapshot(privateSnapshot,privateJob.jobId);
  assert.equal((await privateStores[1].getSnapshot(privateJob.repositoryId)).sources[0].content,'fabricated-sensitive-content');
  const encrypted=await pools[0].query('SELECT snapshot FROM whycode_runtime.private_indexes WHERE namespace=$1',[ns]);
  assert.ok(!JSON.stringify(encrypted.rows).includes('fabricated-sensitive-content'));
  await pools[0].query("UPDATE whycode_runtime.private_indexes SET lease_until=now()-interval '1 second' WHERE namespace=$1 AND repository_id=$2",[ns,privateJob.repositoryId]);
  const noFetch={getRepository:async()=>{throw Error('Saved snapshot should be reused');}};
  const denied=new IndexingService(noFetch,privateStores[0],undefined,async()=>{throw Error('Access revoked');});
  denied.requestRecovery();await IndexingService.waitForActiveJobs();
  assert.equal((await privateStores[1].getStatus(privateJob.repositoryId)).status,'failed');
  let authorized=0;
  const allowed=new IndexingService(noFetch,privateStores[0],undefined,async()=>{authorized++;});
  allowed.requestRecovery();await IndexingService.waitForActiveJobs();
  assert.equal(authorized,1);assert.equal((await privateStores[1].getStatus(privateJob.repositoryId)).status,'complete');
  const other=new CentralIndexStore(pools[1],ns,{id:'other-scope',expires:session.expires,key:env.SESSION_ENCRYPTION_KEY});
  assert.equal(await other.getSnapshot(privateJob.repositoryId),undefined);
  await sessions.remove('mock-cookie-hash');
  assert.equal(await privateStores[1].getSnapshot(privateJob.repositoryId),undefined);
  await assert.rejects(()=>privateStores[0].saveSnapshot(privateSnapshot,privateJob.jobId));
  await privateStores[0].dispose();
  const recovery=status('recovery');assert.ok(await stores[0].claimJob(recovery));
  await stores[0].saveSnapshot(snapshot(recovery),recovery.jobId);
  await pools[0].query("UPDATE whycode_runtime.repository_indexes SET lease_until=now()-interval '1 second' WHERE namespace=$1 AND repository_id=$2",[ns,recovery.repositoryId]);
  let fetched=0,graphWrites=0;
  const github={getRepository:async()=>{fetched++;throw Error('must reuse saved snapshot');}};
  const graph={saveRepositoryHistory:async()=>{graphWrites++;return {nodesWritten:1,relationshipsWritten:0,durationMs:1};}};
  new IndexingService(github,stores[0],graph);new IndexingService(github,stores[1],graph);
  await IndexingService.waitForActiveJobs();
  assert.equal((await stores[1].getStatus(recovery.repositoryId)).status,'complete');
  assert.equal(fetched,0);assert.equal(graphWrites,1);
  await assert.rejects(()=>stores[0].saveSnapshot(snapshot(recovery),recovery.jobId));
  IndexingService.stopRecovery();
  const incomplete=status('incomplete-recovery');assert.ok(await stores[0].claimJob(incomplete));
  await pools[0].query("UPDATE whycode_runtime.repository_indexes SET lease_until=now()-interval '1 second' WHERE namespace=$1 AND repository_id=$2",[ns,incomplete.repositoryId]);
  let collected=0;
  const fullGithub={getRepository:async()=>{collected++;return {full_name:incomplete.repository,html_url:'https://github.com/'+incomplete.repository,default_branch:'main'};},
    listCommitWindow:async()=>({commits:[],history:{head:'head',offset:0,hasMore:false}}),listChangedFiles:async()=>({files:[],commitFiles:[],limited:false}),
    listPullRequests:async()=>[],listIssues:async()=>[],listComments:async()=>[],listSources:async()=>({sources:[],revision:'head',totalFiles:0,truncatedTree:false})};
  new IndexingService(fullGithub,stores[0],graph);await IndexingService.waitForActiveJobs();
  assert.equal(collected,1);assert.equal((await stores[1].getStatus(incomplete.repositoryId)).status,'complete');
  if(!env.NEO4J_URI)throw Error('Neo4j configuration required for graph fencing proof');
  neo4j=new Neo4jConnection({uri:env.NEO4J_URI,username:env.NEO4J_USERNAME,password:env.NEO4J_PASSWORD,database:env.NEO4J_DATABASE});
  const graphStore=new Neo4jGraphStore(neo4j),graphJob=status(randomUUID());graphId=graphJob.repositoryId;
  await graphStore.saveRepositoryHistory({...snapshot(graphJob),fullName:'newer-test-snapshot'},2);
  await assert.rejects(()=>graphStore.saveRepositoryHistory({...snapshot(graphJob),fullName:'stale-test-snapshot'},1));
  await assert.rejects(()=>graphStore.saveRepositoryHistory({...snapshot(graphJob),fullName:'unfenced-test-snapshot'}));
  const check=neo4j.session();try{const result=await check.run('MATCH(r:Repository{repositoryId:$id}) RETURN r.fullName AS name',{id:graphId});assert.equal(result.records[0].get('name'),'newer-test-snapshot');}finally{await check.close();}
  console.log('PASS: global concurrency, encrypted private continuity/isolation/revocation, recovery deduplication, stale PostgreSQL writes and real Neo4j generation fencing.');
}catch(error){console.error('Worker verification failed: '+(error?.code??error?.name??'unknown')+'; secrets withheld.'); console.error(String(error?.stack).split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,4).join('\n'));process.exitCode=1;}
finally{
  IndexingService.stopRecovery();await IndexingService.waitForActiveJobs();
  if(neo4j){const s=neo4j.session();try{if(graphId)await s.run('MATCH(r:Repository{repositoryId:$id}) DETACH DELETE r',{id:graphId});}finally{await s.close();await neo4j.close();}}
  for(const table of ['private_indexes','private_index_imports','repository_indexes','sessions','worker_gate'])await pools[0].query(`DELETE FROM whycode_runtime.${table} WHERE namespace=$1`,[ns]).catch(()=>{});
  await Promise.all(pools.map(p=>p.end()));
}
