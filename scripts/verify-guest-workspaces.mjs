// Uses a temporary namespace and fabricated public repository identifiers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import { GuestWorkspaces } from '../apps/api/src/services/guest-workspace.ts';
import { SharedGuestWorkspaces } from '../apps/api/src/infrastructure/shared-guest-workspaces.ts';
import { createPostgresPool } from '../apps/api/src/infrastructure/postgres.ts';
const env=dotenv.parse(readFileSync('.env')), namespace=`guest-check-${randomUUID()}`;
const pools=[0,1].map(()=>createPostgresPool(env.DATABASE_URL,env.DATABASE_SSL_CA_FILE));
const stores=pools.map(pool=>new SharedGuestWorkspaces(pool,namespace,env.SESSION_ENCRYPTION_KEY));
const servers=[],bases=[];
const headers={'Content-Type':'application/json'};
try {
  for(const store of stores){
    const guests=new GuestWorkspaces(false,undefined,undefined,store),app=express();
    app.use(express.json()); app.use(guests.middleware);
    app.get('/state',(req,res)=>res.json({a:guests.includes(req,'github:test/a'),b:guests.includes(req,'github:test/b')}));
    app.post('/add',(req,res)=>{guests.add(req,req.body.id);res.json({ok:true});});
    app.post('/remove',(req,res)=>res.json({removed:guests.remove(req,req.body.id)}));
    const server=app.listen(0,'127.0.0.1');servers.push(server);
    await new Promise(resolve=>server.once('listening',resolve));bases.push(`http://127.0.0.1:${server.address().port}`);
  }
  const start=await fetch(bases[0]+'/state');const cookie=start.headers.getSetCookie()[0].split(';')[0];await start.json();
  await Promise.all(bases.map((base,i)=>fetch(base+'/add',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({id:`github:test/${i?'b':'a'}`})}).then(r=>assert.equal(r.status,200))));
  assert.deepEqual(await fetch(bases[1]+'/state',{headers:{Cookie:cookie}}).then(r=>r.json()),{a:true,b:true});
  assert.deepEqual(await fetch(bases[0]+'/state').then(r=>r.json()),{a:false,b:false});
  assert.equal((await fetch(bases[1]+'/remove',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({id:'github:test/a'})})).status,200);
  assert.deepEqual(await fetch(bases[0]+'/state',{headers:{Cookie:cookie}}).then(r=>r.json()),{a:false,b:true});
  await stores[0].commit('expired-test',{repositories:[],history:[],expires:Date.now()-1000},[]);
  assert.equal(await stores[1].get('expired-test'),undefined);
  console.log('PASS: cross-instance guest continuity, concurrent updates, browser isolation, deletion and expiry.');
}catch{console.error('Guest-workspace integration failed; credentials withheld.');process.exitCode=1;}
finally{await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));await pools[0].query('DELETE FROM whycode_runtime.guest_workspaces WHERE namespace=$1',[namespace]).catch(()=>{});await Promise.all(pools.map(p=>p.end()));}
