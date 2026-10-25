import { _electron } from 'playwright';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const home='/Users/agmazin/Library/Developer/paseo-dialogs-menu-home';
const client=new DaemonClient({url:'ws://127.0.0.1:6796/ws',clientId:'row-menu-test',clientType:'cli',localCredential:()=>readFileSync(`${home}/local-credential`,'utf8').trim(),reconnect:{enabled:false}});
let app;
const out=resolve(process.env.SHOTS || 'docs/shots/0.10.0');mkdirSync(out,{recursive:true});
let id;
try {
 await client.connect();assert.equal((await client.getDaemonStatus()).version,'0.12.0');
 const fixtureFile=`${home}/row-menu-fixture.json`;
 if(existsSync(fixtureFile)) id=JSON.parse(readFileSync(fixtureFile)).id;
 else {
   const base=(await client.fetchAgent('03e7e46f-0eaa-4068-9a43-c1a15d3fca97')).agent;
   const created=await client.createAgent({provider:'claude',cwd:base.cwd,workspaceId:base.workspaceId,title:'Проверка меню',initialPrompt:'Ответь одним словом: ок'});
   id=created.id;writeFileSync(fixtureFile,JSON.stringify({id}));
   const end=Date.now()+60000;
   while(Date.now()<end){const a=(await client.fetchAgent(id)).agent;if(a.status==='idle' && a.persistence?.sessionId)break;await new Promise(resolve=>setTimeout(resolve,1000))}
 }
 const old=(await client.fetchAgent(id)).agent;
 if(old.archivedAt)await client.importAgent({provider:old.provider,sessionId:old.persistence.sessionId,cwd:old.cwd,workspaceId:old.workspaceId,labels:old.labels});
 const key=old.labels['kanban.key'] || 'AGM-14';
 await client.updateAgent(id,{name:`${key}: Проверка меню`,labels:{...old.labels,'kanban.key':key}});
 app=await _electron.launch({executablePath:'/Users/agmazin/Library/Developer/paseo-tabs/desktop-test/runtime44/Electron.app/Contents/MacOS/Electron',args:[resolve('tests/browser/menu-host.cjs')]});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('console',m=>{if(m.type()==='error') console.log('BROWSER',m.text())});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const row=page.getByTestId(`dialogs-agent-${id}`);await row.waitFor({timeout:60000});console.log("row ready");
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__clipboard=value}}})});
 const menu=page.getByTestId('dialogs-agent-menu');
 const open=async()=>{if(!await row.isVisible())await page.getByTestId('menu-button').click();await row.click({button:'right'});await menu.waitFor()};
 const select=async text=>{console.log("SELECT",text);return menu.getByRole('button',{name:text,exact:true}).click()};
 await row.hover();await row.getByTestId('dialogs-agent-more').click();await menu.waitFor();await select('Скопировать ID агента');await page.waitForFunction(id=>window.__clipboard===id,id);
 await open();await select('Копировать команду продолжения');await page.waitForFunction(()=>/^(codex resume|claude --resume) /.test(window.__clipboard),null,{timeout:20000});
 assert.equal(await page.evaluate(()=>window.__clipboard),`${old.provider === "codex" ? "codex resume" : "claude --resume"} ${old.runtimeInfo?.sessionId || old.persistence.sessionId}`);
 await open();await select('Переименовать');const input=page.getByRole('textbox',{name:'Название диалога'});
 await input.fill('Новое имя');await input.press('Escape');assert.equal((await client.fetchAgent(id)).agent.title,`${key}: Проверка меню`);
 await open();await select('Переименовать');await input.fill('Новое имя');await input.press('Enter');await page.waitForTimeout(1000);
 assert.equal((await client.fetchAgent(id)).agent.title,`${key}: Новое имя`);
 // Open the native pinned tab, independent of the navigation fix in another card.
 await page.evaluate(async ({workspace,id,server})=>{
   for(const script of document.scripts){
    if(!script.src.includes('/static/js/'))continue;
    const source=await(await fetch(script.src)).text();
    for(const line of source.split('\n')){
     if(!line.includes('hideAgent:')||!line.includes('unhideAgent:')||!line.includes('closeTab:'))continue;
     const match=line.match(/\},(\d+),\[[\d,]*\]\);$/);if(!match)continue;
     for(const store of Object.values(window.__r(Number(match[1])))){
      if(typeof store?.getState!=='function')continue;
      const state=store.getState();if(!state.layoutByWorkspace||typeof state.hideAgent!=='function')continue;
      const key=Object.keys(state.layoutByWorkspace).find(key=>key.endsWith(':'+workspace)) || `${server}:${workspace}`;
      const url=`/h/${server}/workspace/${workspace}`;history.pushState(history.state,'',url);dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
      state.unhideAgent(key,id);state.openTab({workspaceKey:key,target:{kind:'agent',agentId:id},pin:true});return;
     }
    }
   }
   throw new Error('layout not found');
 },{workspace:old.workspaceId,id,server:readFileSync(`${home}/server-id`,"utf8").trim()});
 await page.getByTestId(`workspace-tab-agent_${id}`).waitFor();
 await open();await menu.getByRole('button',{name:'Закрыть вкладку',exact:true}).waitFor();
 await page.screenshot({path:`${out}/active-menu.png`});
 await select('Закрыть вкладку');await page.waitForTimeout(500);assert.equal(await page.getByTestId(`workspace-tab-agent_${id}`).count(),0);assert.equal(!!(await client.fetchAgent(id)).agent.archivedAt,false);
 await open();assert.equal(await menu.getByRole('button',{name:'Закрыть вкладку',exact:true}).count(),0);await select('Перезагрузить агента');await page.getByText('Агент перезагружен',{exact:true}).waitFor({timeout:30000});assert.equal(!!(await client.fetchAgent(id)).agent.archivedAt,false);
 for(const width of [800,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(700);await open();await page.screenshot({path:`${out}/menu-${width}.png`});await page.getByRole('dialog').getByLabel('Закрыть меню',{exact:true}).click({position:{x:width-5,y:850}})}
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(700);
 await open();await select('Архивировать');await page.waitForTimeout(1000);
 const archived=(await client.fetchAgent(id)).agent;assert.ok(archived.archivedAt);assert.ok(archived.labels['paseo.explicit-archive-at']);
 const group=page.getByTestId(`dialogs-group-${old.workspaceId}`);if(!await row.count())await group.getByText('Архив',{exact:true}).click();await row.waitFor();await open();
 assert.equal(await menu.getByRole('button').count(),3);await menu.screenshot({path:`${out}/archive-menu.png`});await select('Скопировать ID агента');
 await page.evaluate(({server,workspace})=>{history.pushState(history.state,'',`/h/${server}/plugin/paseo-dialogs/surface/archive?param.workspaceId=${workspace}`);dispatchEvent(new PopStateEvent('popstate',{state:history.state}))},{server:readFileSync(`${home}/server-id`,'utf8').trim(),workspace:old.workspaceId});
 const archiveScreen=page.getByTestId('dialogs-archive-screen');await archiveScreen.waitFor();
 await archiveScreen.getByTestId(`dialogs-agent-${id}`).click({button:'right'});
 const archiveDialog=page.getByRole('dialog');await archiveDialog.getByRole('button',{name:'Разархивировать',exact:true}).waitFor();
 await archiveDialog.screenshot({path:`${out}/full-archive-menu.png`});
 await archiveDialog.getByRole('button',{name:'Разархивировать',exact:true}).click();await page.waitForTimeout(1000);assert.equal(!!(await client.fetchAgent(id)).agent.archivedAt,false);
 assert.deepEqual(errors,[]);writeFileSync('docs/row-menu-verification.json',JSON.stringify({fixtureId:id,client:'0.13.0',daemon:'0.12.0',checks:['id','resume','rename Escape/Enter prefix','close without archive','hidden close when tab absent','reload','archive labels','archive menu and full archive restore','1440/800/390'],errors},null,2)+'\n');
 console.log('PASS row menu desktop');
}catch(error){if(app){const page=await app.firstWindow();await page.screenshot({path:`${out}/failure.png`});console.log((await page.locator('body').innerText()).slice(-3500))}throw error;}finally{await app?.close();await client.close()}
