import { _electron } from 'playwright';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const home='/Users/agmazin/Library/Developer/paseo-dialogs-waiting-home';
const fixture=JSON.parse(readFileSync(`${home}/waiting-fixture.json`));
const out=resolve('docs/shots/0.10.2');mkdirSync(out,{recursive:true});
const client=new DaemonClient({url:'ws://127.0.0.1:6798/ws',clientId:'waiting-test',clientType:'cli',localCredential:()=>readFileSync(`${home}/local-credential`,'utf8').trim(),reconnect:{enabled:false}});
let app;
try {
 await client.connect();
 assert.equal((await client.getDaemonStatus()).version, "0.12.0");
 const rpc=await client.invokePluginRpc('paseo-dialogs','dialogs.agents',{archives:[],limit:0});
 assert.equal(rpc.agents.length,7);
 for(const [index,reason] of [[2,'permission'],[3,'ask'],[4,'review'],[6,'ask']])assert.equal(rpc.agents.find(a=>a.id===fixture[index].id).waitReason,reason);
 app=await _electron.launch({executablePath:'/Users/agmazin/Library/Developer/paseo-tabs/desktop-test/runtime44/Electron.app/Contents/MacOS/Electron',args:[resolve('tests/browser/waiting-host.cjs')]});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const root=page.getByTestId(`dialogs-agent-${fixture[0].id}`);
 if (!await root.isVisible()) await page.getByTestId(`dialogs-group-${fixture[0].workspaceId}`).getByTestId('dialogs-group-handle').click();
 await root.waitFor({timeout:60000});
 assert.equal(await root.getByTestId('dialogs-status-needs_input').count(),1);
 assert.equal(await root.getByTestId('dialogs-status-running').count(),0);
 assert.equal(await root.getByTestId('dialogs-subagents-pair').count(),0);
 assert.equal(await root.getByRole('button',{name:fixture[0].title,exact:true}).getAttribute('title'),'Ждут тебя: 3');
 await page.screenshot({path:`${out}/collapsed-1440.png`});
 await root.getByTestId('dialogs-subagents-toggle').click();
 for(const [i,hint] of [[2,'разрешение'],[3,'вопрос'],[4,'приёмка']]) {
  const row=page.getByTestId(`dialogs-agent-${fixture[i].id}`);await row.waitFor();
  assert.equal(await row.getByTestId('dialogs-status-needs_input').count(),1);
  assert.equal(await row.getByTestId('dialogs-subagent-dot').count(),0);
  assert.equal(await row.getByRole('button',{name:fixture[i].title,exact:true}).getAttribute('title'),`Ждёт тебя: ${hint}`);
 }
 assert.equal(await page.getByTestId(`dialogs-agent-${fixture[5].id}`).getByTestId('dialogs-subagent-dot').count(),1);
 for(const scheme of ['dark','light']) {
  await page.emulateMedia({colorScheme:scheme});
  for(const width of [1440,800,390]) {
   await page.setViewportSize({width,height:900});await page.waitForTimeout(500);
   if(!await root.isVisible())await page.getByTestId('menu-button').click();
   await root.waitFor();
   if (!await page.getByTestId(`dialogs-agent-${fixture[2].id}`).isVisible()) await root.getByTestId('dialogs-subagents-toggle').click();
   await page.getByTestId(`dialogs-agent-${fixture[2].id}`).waitFor();
   await page.screenshot({path:`${out}/expanded-${scheme}-${width}.png`});
  }
 }
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(500);
 const group=page.getByTestId(`dialogs-group-${fixture[0].workspaceId}`);
 await group.getByTestId('dialogs-group-handle').click();
 await root.waitFor({state:'hidden'});
 assert.equal(await group.getByTestId('dialogs-status-running').count(),0);
 assert.equal(await group.getByTestId('dialogs-status-needs_input').count(),1);
 await page.screenshot({path:`${out}/group-collapsed.png`});
 assert.deepEqual(errors,[]);
 writeFileSync('docs/waiting-0.10.2.json',JSON.stringify({client:'0.13.0',daemon:(await client.getDaemonStatus()).version,electron:await app.evaluate(({app})=>process.versions.electron),fixture:'deterministic agent snapshots through real dialogs.agents handler on isolated test plugin copy',checks:['running+permission','idle+ask','running+review','nested idle bridge','parent collapsed/expanded','one worker retains spinner','collapsed group excludes waiting from running','1440/800/390','dark/light'],errors},null,2)+'\n');
 console.log('PASS waiting desktop');
} finally {await app?.close();await client.close()}
