import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from './dist/server.js';
test('retention, scope, pins, ownership, recheck and retry', async () => {
 const policy = {enabled:false, projects:'test', days:30};
 const old = Date.now()-30*86400000;
 const row = (id, extra={}) => ({id, projectId:'test', archivedAt:old, pinnedAt:null, ...extra});
 const rows = [row('eligible'),row('pinned',{pinnedAt:old}),row('recent',{archivedAt:Date.now()}),row('owner'),row('restored'),row('foreign',{projectId:'else',archivedAt:null,lifecycleOwnerThreadId:'owner'})];
 let schedule, cli, deleted=[], reads=0;
 plugin({settings:{define:()=>({get:async()=>policy})}, background:{schedule:(n,c,f)=>schedule=f},cli:{register:v=>cli=v},storage:{kv:{set:async()=>{}}},log:{info(){}},sdk:{threads:{
 list:async ({archived,includeHidden})=>{assert.equal(includeHidden,true); if(archived && ++reads===3) rows.find(r=>r.id==='restored').archivedAt=null; return rows.filter(r=>(r.archivedAt!==null)===archived);},
 delete:async ({threadId,childThreadsConfirmed})=>{assert.equal(childThreadsConfirmed,false);deleted.push(threadId); rows.splice(rows.findIndex(r=>r.id===threadId),1);}
 }}});
 await schedule(); assert.deepEqual(deleted,[]);
 const preview=JSON.parse((await cli.run(['preview'])).stdout);
 assert.equal(preview.find(r=>r.id==='owner').outcome,'has dependents');
 policy.enabled=true; await schedule(); await schedule();
 assert.deepEqual(deleted,['eligible']);
});
