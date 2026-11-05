import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const home='/Users/agmazin/Library/Developer/paseo-dialogs-actions-home';
const c=new DaemonClient({url:'ws://127.0.0.1:6797/ws',clientId:'dialogs-self-title-gate',clientType:'cli',localCredential:async()=>(await readFile(`${home}/local-credential`,'utf8')).trim()});
let id:string|undefined;
try {
 await c.connect();assert.equal((await c.getDaemonStatus()).version,'0.14.0');
 const cwd='/private/tmp/dialogs-naming-fixture';await mkdir(cwd,{recursive:true});
 const workspaceId=(await c.createWorkspace({source:{kind:'directory',path:cwd},title:'Naming fixture'})).workspace.id;
 const a=await c.createAgent({config:{provider:'codex',model:'gpt-6.1-sol',cwd,modeId:'full-access',systemPrompt:'После служебного названия чата ответь только словом Хорошо.'},workspaceId});id=a.id;
 await c.sendMessage(id,'Помоги настроить полив цветов.');await c.waitForFinish(id,60000);
 const timeline=await c.fetchAgentTimeline(id,{direction:'before',limit:100});
 const first=timeline.entries.find(e=>['tool_call','assistant_message'].includes(e.item.type));assert.equal(first?.item.type,'tool_call');assert.match(JSON.stringify(first),/name_this_chat/);
 const named=(await c.fetchAgent(id))!.agent;assert.match(named.title!,/^[А-ЯЁ]/);
 const scopes=JSON.parse(await readFile(`${home}/plugin-data/paseo-dialogs/self-titles.json`,'utf8'));
 const duplicate=await c.invokePluginRpc('paseo-dialogs','dialogs.self-title',{token:scopes[id].token,title:'Другой заголовок'});
 assert.equal((await c.fetchAgent(id))!.agent.title,named.title);
 await c.archiveAgent(id);await c.invokePluginRpc('paseo-dialogs','dialogs.self-title',{token:scopes[id].token,title:'Другой заголовок'});assert.ok((await c.fetchAgent(id))!.agent.archivedAt);
 console.log(JSON.stringify({id,title:named.title,firstTool:true,duplicate,archivePreserved:true}));
}finally{if(id)await c.archiveAgent(id).catch(()=>{});await c.close();}
