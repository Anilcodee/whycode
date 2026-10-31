/** Local UI fixtures only. Build web first, then: node qa-audit/responsive-preview.mjs
 * Open /qa/account or /qa/guest on http://localhost:4180.
 * No real authentication, repositories, databases or model calls are used.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json());
const dist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const repo = { repositoryId:'github:example/long-repository-name-for-responsive-testing', repository:'example/long-repository-name-for-responsive-testing', jobId:'fixture', status:'complete', counts:{commits:25,files:8,pullRequests:2,issues:3,comments:4,documents:2}, progress:{phase:'Complete',completed:6,total:6},warnings:[],errors:[],history:{head:'abc123456789',offset:25,hasMore:true},coverage:{revision:'abc123456789',indexedFiles:8,totalFiles:8,limits:[],truncatedTree:false} };
const evidence = {id:'commit:1',type:'commit',title:'Document repository architecture and contribution guidelines',excerpt:'Add README with setup instructions and project architecture.',url:'https://github.com/octocat/Hello-World',author:'Example contributor',date:'2026-10-30T10:00:00Z',relationToAnswer:'Introduced project documentation',graphPath:[repo.repositoryId,'commit:1']};
const answer = {savedId:'fixture-answer',repositoryId:repo.repositoryId,question:'Which change introduced the project documentation?',answer:'The documentation was introduced in the indexed documentation commit. [1]',abstained:false,evidence:[evidence],citedEvidenceIds:['commit:1'],confidence:{label:'supported',reason:'Fixture source available'},temporalStatus:'historical',answeredAt:'2026-10-31T10:00:00Z',warnings:['Local UI fixture; not an actual model response.'],decisionTimeline:[{evidenceId:evidence.id,title:evidence.title,date:evidence.date,type:'commit'}]};
app.get('/qa/:mode',(req,res)=>{res.cookie('whycode_ui_fixture',req.params.mode,{httpOnly:true,sameSite:'lax'});res.redirect(req.params.mode==='account'?'/workspace':'/');});
app.use('/api',async(req,res)=>{
  const signed=(req.headers.cookie??'').includes('whycode_ui_fixture=account');
  const route=req.path;
  // The account check deliberately finishes after /auth/session to exercise startup reveal timing.
  await new Promise(resolve=>setTimeout(resolve,route==='/account/session'?750:route.includes('history')?900:route==='/ask'?1800:route.endsWith('/graph')?1200:250));
  if(route==='/auth/session')return res.json({required:false,authenticated:true});
  if(route==='/account/session')return res.json({configured:true,providers:['email','github','google'],user:signed?{id:'fixture',email:'reviewer@example.test'}:null,github:signed?{login:'example'}:null,privateEnabled:true,installUrl:null});
  if(route==='/account/workspace/guest-preview')return res.json({repositories:1,investigations:1});
  if(route.endsWith('/health'))return res.json({dependencies:{database:'connected',answerProvider:'configured:fixture',translation:'configured',externalSearch:'configured',access:'public',persistence:'fixture'}});
  if(route.endsWith('/workspace/history'))return res.json({history:signed?[answer]:[],repositories:signed?[repo]:[]});
  if(route.endsWith('/repositories'))return res.json({repositories:signed?[repo]:[]});
  if(route.endsWith('/validate'))return res.json({repository:repo.repository});
  if(route.endsWith('/ingest'))return res.json(repo);
  if(route.endsWith('/status'))return res.json(repo);
  if(route.endsWith('/graph'))return res.json({nodes:[{id:repo.repositoryId,type:'repository',label:repo.repository},{id:'commit:1',type:'commit',label:evidence.title},{id:'file:readme',type:'file',label:'README.md'}],edges:[{from:repo.repositoryId,to:'commit:1',type:'contains'},{from:'commit:1',to:'file:readme',type:'changed'}]});
  if(route.endsWith('/ask'))return res.json(answer);
  return res.json({ok:true,imported:1,repositories:1});
});
app.use(express.static(dist));
app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
const server=app.listen(4180,'127.0.0.1',()=>console.log('UI fixture preview: http://localhost:4180/qa/account'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
