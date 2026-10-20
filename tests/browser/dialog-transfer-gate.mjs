// Protocol gate only, isolated daemon and fixed test agents. No hard deletion.
import assert from "node:assert/strict";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { mkdir, writeFile } from "node:fs/promises";
const c = new DaemonClient({url:"ws://127.0.0.1:6782/ws",clientId:"agm31-final-gate",clientType:"cli"});
const source="wks_32452d156e2be400",target="wks_23eb8948b1bdb7cd";
const results=[];
try {
  await c.connect();
  for (const id of ["c50e4621-ab33-404a-ae63-ad1266e32433","be7712a6-11b9-4a56-b916-97b7ddbfe030"]) {
    const {agent:a}=await c.fetchAgent(id);
    assert.ok(["idle","closed"].includes(a.status));
    const dest=a.workspaceId===source?target:source;
    const request={provider:a.provider,sessionId:a.persistence.sessionId,cwd:a.cwd,labels:a.labels};
    const text=async()=> (await c.fetchAgentTimeline(id)).entries
      .filter(e=>["user_message","assistant_message"].includes(e.item.type)).map(e=>({type:e.item.type,text:e.item.text}));
    const before=await text();
    await c.archiveAgent(id);
    const moved=await c.importAgent({...request,workspaceId:dest});
    assert.equal(moved.id,id);assert.equal(moved.workspaceId,dest);
    assert.deepEqual(await text(),before);
    await c.sendMessage(id,"Какое слово я просил запомнить? Ответь одним словом. Не используй инструменты.");
    await c.waitForFinish(id,60000);
    const conversation=await text();
    assert.match(conversation.filter(e=>e.type==="assistant_message").at(-1).text,/ЛИМОН/);
    // Test a real protocol rejection after archiving, then restore original home.
    await c.archiveAgent(id);
    await assert.rejects(c.importAgent({...request,workspaceId:"wks_agm31_missing"}),/Workspace not found/);
    const rolledBack=await c.importAgent({...request,workspaceId:a.workspaceId});
    assert.equal(rolledBack.id,id);assert.equal(rolledBack.workspaceId,a.workspaceId);
    assert.deepEqual(await text(),conversation);
    const agents=await c.fetchAgents({filter:{includeArchived:true},page:{limit:200}});
    assert.equal(agents.entries.filter(e=>e.agent.persistence?.sessionId===request.sessionId).length,1);
    if(a.archivedAt) await c.archiveAgent(id);
    results.push({provider:a.provider,agentId:id,sessionId:request.sessionId,
      sameIdentity:true,historyPreserved:true,rememberedWord:"ЛИМОН",
      invalidWorkspaceRejected:true,rollbackPreservedHistory:true,singleRecord:true,hardDelete:false});
  }
  await mkdir("artifacts/0.5",{recursive:true});
  await writeFile("artifacts/0.5/gate-result.json",JSON.stringify(results,null,2)+"\n");
  console.log("PASS: Claude and Codex archive/import, complete text history, ЛИМОН, invalid workspace rollback, exactly one record");
}finally{await c.close();}
