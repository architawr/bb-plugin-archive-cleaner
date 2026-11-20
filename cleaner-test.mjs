import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from './dist/server.js';
test('retention, scope, pins, ownership, recheck and retry', async () => {
 const policy = {enabled:false, projects:'test', days:30};
 const old = Date.now()-30*86400000;
 const row = (id, extra={}) => ({id, projectId:'test', archivedAt:old, pinnedAt:null, ...extra});
 const rows = [row('eligible'),row('pinned',{pinnedAt:old}),row('recent',{archivedAt:Date.now()}),row('owner'),row('restored'),row('foreign',{projectId:'else',archivedAt:null,lifecycleOwnerThreadId:'owner'})];
 let handlers, schedule, cli, deleted=[], reads=0;
 const store=new Map();
 await plugin({rpc:{register(contract,h){handlers=h}},settings:{define:()=>({get:async()=>policy})}, background:{service:(n,service)=>{schedule=async()=>{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),10);
   try { await service.start(controller.signal); } finally {clearTimeout(timer);}
 }}},cli:{register:v=>cli=v},storage:{kv:{get:async k=>store.get(k),set:async(k,v)=>store.set(k,v)}},log:{info(){}},sdk:{projects:{list:async()=>[{id:'test',name:'Test'},{id:'else',name:'Else'}]},threads:{
 list:async ({archived,includeHidden})=>{assert.equal(includeHidden,true); if(archived && ++reads===3) rows.find(r=>r.id==='restored').archivedAt=null; return rows.filter(r=>(r.archivedAt!==null)===archived);},
 delete:async ({threadId,childThreadsConfirmed})=>{assert.equal(childThreadsConfirmed,false);deleted.push(threadId); rows.splice(rows.findIndex(r=>r.id===threadId),1);}
 }}});
 await schedule(); assert.deepEqual(deleted,[]);
 const preview=JSON.parse((await cli.run(['preview'])).stdout);
 assert.equal(preview.find(r=>r.id==='owner').outcome,'has dependents');
 await handlers.saveScope({includeNew:true,projectIds:['test'],visibleIds:['test','else']});
 rows.push(row('excluded',{projectId:'else'}));
 rows.push(row('new-project-thread',{projectId:'new-project'}));
 policy.enabled=true; await schedule(); await schedule();
 assert.deepEqual(deleted,['eligible','new-project-thread']);
 const after=reads;
 await schedule(); assert.equal(reads,after);
 store.get('last').at-=4*86400000;
 await schedule(); assert.ok(reads>after);
 const recovered=reads;
 await schedule(); assert.equal(reads,recovered);
 store.set('last',{at:Date.now()-6*60000,failed:true});
 await schedule(); assert.ok(reads>recovered);
});
