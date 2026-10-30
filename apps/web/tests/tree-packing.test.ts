import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRepositoryTree, repositoryPath } from '../src/lib/repository-tree';

const graph = { nodes:[{id:'root',type:'repository',label:'Repository'}, ...Array.from({length:8},(_,i)=>({id:`commit-${i}`,type:'commit',label:`Commit ${i}`})), ...Array.from({length:28},(_,i)=>({id:`file-${i}`,type:'file',label:`File ${i}`}))], edges:[...Array.from({length:8},(_,i)=>({from:'root',to:`commit-${i}`,type:'CONTAINS'})), ...Array.from({length:28},(_,i)=>({from:`commit-${i%8}`,to:`file-${i}`,type:'CHANGED'}))] };
test('large fan-outs fill a landscape canvas instead of shrinking into a tall column',()=>{
 const tree=buildRepositoryTree(graph,1.7);
 assert.equal(tree.positions.size,graph.nodes.length);
 const ratio=tree.width/tree.height;
 assert.ok(ratio>1.1 && ratio<2.4, `Unexpected aspect ${ratio}`);
 assert.ok(tree.width/tree.height>880/(28*112+80));
 const cards=[...tree.positions.values()];
 for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++) assert.ok(Math.abs(cards[i].x-cards[j].x)>=220 || Math.abs(cards[i].y-cards[j].y)>=100,'Cards must not overlap');
 assert.deepEqual(repositoryPath(tree,'file-12').ids,['root','commit-4','file-12']);
});
test('packing responds to the available space without dropping nodes or relationships',()=>{
 const landscape=buildRepositoryTree(graph,2.1),portrait=buildRepositoryTree(graph,.65);
 assert.ok(landscape.width/landscape.height>portrait.width/portrait.height);
 assert.equal(landscape.parent.size,portrait.parent.size);
 assert.deepEqual([...landscape.nodes.keys()],[...portrait.nodes.keys()]);
});
