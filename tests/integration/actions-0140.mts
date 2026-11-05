import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { transfer, connectTransferClient } from '../../server/transfer.ts';
const home='/Users/agmazin/Library/Developer/paseo-dialogs-actions-home';
const c=new DaemonClient({url:'ws://127.0.0.1:6797/ws',clientId:'dialogs-actions-gate',clientType:'cli',localCredential:async()=>(await readFile(`${home}/local-credential`,'utf8')).trim()});
try {
 await c.connect(); await connectTransferClient(c,(await c.getDaemonStatus()).serverId); assert.equal((await c.getDaemonStatus()).version,'0.14.0');
 const cwd='/private/tmp/dialogs-actions-fixture'; await mkdir(cwd,{recursive:true});
 const source=(await c.createWorkspace({source:{kind:'directory',path:cwd},title:'Actions source'})).workspace.id;
 const target=(await c.createWorkspace({source:{kind:'directory',path:cwd},title:'Actions target'})).workspace.id;
 const a=await c.createAgent({config:{provider:'codex',model:'gpt-6.1-sol',cwd,title:'Проверка действий',modeId:'full-access',systemPrompt:'Ответь только словом ЛИМОН. Инструменты не используй.'},workspaceId:source});
 await c.sendMessage(a.id,'Ответь словом ЛИМОН.');
 await c.waitForFinish(a.id,60000);
 const get=async()=>(await c.fetchAgent(a.id))!.agent;
 const history=async()=>(await c.fetchAgentTimeline(a.id)).entries.filter(e=>['user_message','assistant_message'].includes(e.item.type)).map(e=>({type:e.item.type,text:(e.item as any).text}));
 const before=await history();assert.ok(before.length>=2); assert.ok((await get()).persistence?.sessionId);
 const rpc=(action:string,title?:string)=>c.invokePluginRpc('paseo-dialogs','dialogs.action',{agentId:a.id,action,title});
 await rpc('rename','Новое имя');assert.equal((await get()).title,'Новое имя');
 await rpc('resume');await rpc('reload');
 await rpc('archive');assert.ok((await get()).archivedAt);
 await rpc('restore');assert.equal((await get()).archivedAt,null);assert.deepEqual(await history(),before);
 // Test the transfer implementation before admitting this daemon version.
 await transfer(c,{agentId:a.id,sourceId:source,targetId:target},{before:async()=>{},restore:async()=>{}});
 assert.equal((await get()).workspaceId,target);assert.deepEqual(await history(),before);
 const proxy=new Proxy(c,{get(obj,key){if(key==='importAgent')return (input:any)=>c.importAgent({...input,workspaceId:input.workspaceId===source?'wks_missing_actions':input.workspaceId});const v=Reflect.get(obj,key);return typeof v==='function'?v.bind(obj):v;}});
 await assert.rejects(transfer(proxy,{agentId:a.id,sourceId:target,targetId:source},{before:async()=>{},restore:async()=>{}}),/восстановлен в исходной папке/);
 assert.equal((await get()).workspaceId,target);assert.equal((await get()).archivedAt,null);assert.deepEqual(await history(),before);
 await c.invokePluginRpc('paseo-dialogs','dialogs.move',{agentId:a.id,sourceId:target,targetId:source});assert.equal((await get()).workspaceId,source);assert.deepEqual(await history(),before);
 const session=(await get()).persistence!.sessionId; const all=await c.fetchAgents({filter:{includeArchived:true},page:{limit:200}});assert.equal(all.entries.filter(e=>e.agent.persistence?.sessionId===session).length,1);
 await writeFile('/tmp/dialogs-actions-fixture.json',JSON.stringify({id:a.id,source,target,home}));
 console.log(JSON.stringify({version:'0.14.0',id:a.id,rename:true,resume:true,reload:true,archiveRestore:true,move:true,rollback:true,history:true}));
}finally{await c.close();}
