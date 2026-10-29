import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { transfer, connectTransferClient } from '../../server/transfer.ts';
const home=process.env.PASEO_TEST_HOME;
const fixturesPath=process.env.PASEO_TEST_FIXTURES;
const agentPath=process.env.PASEO_TEST_AGENT;
assert.ok(home && fixturesPath && agentPath, 'Requires an isolated PASEO_TEST_HOME, PASEO_TEST_FIXTURES and PASEO_TEST_AGENT');
assert.notEqual(home, '/Users/agmazin/.paseo');
const pid=JSON.parse(await readFile(`${home}/paseo.pid`,'utf8'));
assert.equal(pid.listen, '127.0.0.1:6793', 'Only disposable daemon 6793 is allowed');
const serverId=(await readFile(`${home}/server-id`,'utf8')).trim();
const fixture=JSON.parse(await readFile(fixturesPath,'utf8'));
const a=JSON.parse(await readFile(agentPath,'utf8'));
const c=new DaemonClient({url:'ws://127.0.0.1:6793/ws',clientId:'agm22-gate',clientType:'cli'});
let sourceId=fixture.source.workspace.id,targetId=fixture.target.workspace.id;
const get=async(id=a.id)=>(await c.fetchAgent(id))!.agent;
const rpc=(action:string)=>c.invokePluginRpc('paseo-dialogs','dialogs.action',{agentId:a.id,action});
const text=async()=>(await c.fetchAgentTimeline(a.id)).entries.filter(e=>['user_message','assistant_message'].includes(e.item.type)).map(e=>({type:e.item.type,text:(e.item as any).text}));
const result:any={version:'0.13.2',host:'127.0.0.1:6793',agentId:a.id};
try {
 await c.connect();assert.equal((await c.getDaemonStatus()).version,'0.13.2');assert.equal((await c.getDaemonStatus()).serverId,serverId);
 const before=await get();assert.equal(before.labels['agm22.fixture'],'true');
 if(before.workspaceId===targetId)[sourceId,targetId]=[targetId,sourceId];
 assert.equal(before.workspaceId,sourceId);assert.ok(!before.archivedAt);assert.ok(before.persistence?.sessionId);
 const history=await text();assert.ok(history.length>=2);
 await rpc('archive');assert.ok((await get()).archivedAt);assert.ok((await get()).labels['paseo.explicit-archive-at']);
 await rpc('restore');const restored=await get();assert.equal(restored.archivedAt,null);assert.equal(restored.id,before.id);assert.equal(restored.title,before.title);assert.equal(restored.workspaceId,sourceId);assert.deepEqual(await text(),history);
 result.archiveRestoreRpc={sameId:true,title:true,labels:true,history:true,nativeSdk:true};
 const children=[];
 for(const [name,workspaceId,archived] of [['same',sourceId,false],['cross',targetId,false],['old',sourceId,true]] as const){
  const child=await c.createAgent({provider:'codex',model:'gpt-6-luna',workspaceId,cwd:before.cwd,title:'AGM22 '+name,labels:{'paseo.parent-agent-id':a.id,'agm22.fixture':'true'},modeId:'full-access'});
  await c.sendMessage(child.id,'Ответь только: готово. Не используй инструменты.');
  const finished=await c.waitForFinish(child.id,60000);assert.equal(finished.status,'idle');
  if(archived)await c.archiveAgent(child.id);children.push({...child,shouldArchive:archived});
 }
 const stamp=(await get()).labels['paseo.explicit-archive-at'];
 await c.invokePluginRpc('paseo-dialogs','dialogs.move',{agentId:a.id,sourceId,targetId});
 assert.equal((await get()).workspaceId,targetId);assert.deepEqual(await text(),history);
 assert.equal((await get()).labels['paseo.explicit-archive-at'],stamp);
 for(const child of children){const current=await get(child.id);assert.equal(!!current.archivedAt,child.shouldArchive);assert.equal(current.labels['paseo.parent-agent-id'],a.id);}
 result.moveRpc={sameId:true,history:true,title:(await get()).title===before.title,liveChildrenRestored:true,crossWorkspaceParentRestored:true,oldChildStillArchived:true};
 let rejected=false;
 const proxy:any={fetchAgent:c.fetchAgent.bind(c),fetchAgents:c.fetchAgents.bind(c),archiveAgent:c.archiveAgent.bind(c),updateAgent:c.updateAgent.bind(c),close:async()=>{},importAgent:async(input:any)=>{
  if(input.workspaceId===sourceId){rejected=true;return c.importAgent({...input,workspaceId:'wks_agm22_nonexistent'});}
  return c.importAgent(input);
 }};
 await assert.rejects(transfer(proxy,{agentId:a.id,sourceId:targetId,targetId:sourceId},{before:async()=>{},restore:async()=>{}}),/восстановлен в исходной папке/);
 assert.ok(rejected);assert.equal((await get()).workspaceId,targetId);assert.equal((await get()).archivedAt,null);assert.deepEqual(await text(),history);
 for(const child of children){assert.equal(!!(await get(child.id)).archivedAt,child.shouldArchive);}
 result.rollback={realDaemonRejectsMissingWorkspace:true,sourceRestored:true,history:true,children:true};
 const fakeStatus:any=new Proxy(c,{get(obj,key){if(key==='connect')return async()=>{};if(key==='getDaemonStatus')return async()=>({...await c.getDaemonStatus(),version:'0.13.3'});const value=Reflect.get(obj,key);return typeof value==='function'?value.bind(obj):value;}});
 await assert.rejects(connectTransferClient(fakeStatus,(await c.getDaemonStatus()).serverId),/Данные не изменены/);
 assert.equal((await get()).workspaceId,targetId);assert.equal((await get()).archivedAt,null);
 result.unsupportedVersion={rejectedBeforeMutation:true};
 await rpc('archive');await rpc('restore');assert.equal((await get()).archivedAt,null);
 const all=await c.fetchAgents({filter:{includeArchived:true},page:{limit:200}});assert.equal(all.entries.filter(e=>e.agent.persistence?.sessionId===before.persistence!.sessionId).length,1);
 result.singleSessionRecord=true;
 console.log(JSON.stringify(result,null,2));
 if(process.env.PASEO_TEST_RESULT)await writeFile(process.env.PASEO_TEST_RESULT,JSON.stringify(result,null,2));
}finally{await c.close();}
