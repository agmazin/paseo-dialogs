import { _electron } from '/Users/agmazin/Library/Developer/paseo-dialogs/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const base='/Users/agmazin/Library/Developer/paseo-tabs/desktop-test';
const app=await _electron.launch({executablePath:`${base}/runtime44/Electron.app/Contents/MacOS/Electron`,args:[resolve('tests/browser/desktop-host.cjs')]});
try {
 const p=await app.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const checks=[];const out='docs/shots/0.9.2';mkdirSync(out,{recursive:true});
 const id='03e7e46f-0eaa-4068-9a43-c1a15d3fca97';const row=p.getByTestId(`dialogs-agent-${id}`);const tab=p.getByTestId(`workspace-tab-agent_${id}`);
 await row.waitFor({timeout:30000});
 await p.evaluate(()=>{for(const method of ['pushState','replaceState']){const old=history[method].bind(history);history[method]=(...args)=>{if(String(args[2]).includes('/surface/navigate')){setTimeout(()=>old(...args),250);return;}return old(...args);};}});
 for(let i=0;i<4;i++){
  if(i>0){execFileSync('paseo',['plugin','reload','paseo-dialogs','--host','127.0.0.1:6786'],{timeout:60000});await p.waitForTimeout(500);}
  if(i%2)await p.evaluate(()=>{history.pushState(history.state,'','/h/srv_An0DcUySXSA0/workspace/wks_ca364b10fc536aa6');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));});
  await row.click();await tab.waitFor({timeout:5000});
  if(i%2){await p.keyboard.press('Meta+w');}else{await tab.hover();await p.getByTestId(`workspace-agent-close-${id}`).click();}await tab.waitFor({state:'hidden'});await p.waitForTimeout(300);
  checks.push({kind:'active',action:i%2?'Cmd+W':'cross',reopened:true});
  await row.click();
  try{await tab.waitFor({timeout:5000});}catch{console.log('REPRO',i,await p.evaluate(()=>({path:location.href,body:document.body.innerText.slice(-1500)})));throw new Error('reopen failed');}
 }
 const archived='d8d6276f-1365-4644-a33f-b28b88ebdc61';
 const archiveRow=p.getByTestId(`dialogs-agent-${archived}`);
 if(!await archiveRow.count())await p.getByTestId('dialogs-group-wks_15d690ea2b3bfb2f').getByText('Архив',{exact:true}).click();
 for(let i=0;i<3;i++){
  await archiveRow.click();await p.getByText('Разархивировать',{exact:true}).waitFor({timeout:10000});
  const archiveTab=p.getByTestId(`workspace-tab-agent_${archived}`);await archiveTab.waitFor();
  await p.waitForTimeout(300);
  if(i%2)await p.keyboard.press('Meta+w');else{await archiveTab.hover();await p.getByTestId(`workspace-agent-close-${archived}`).click();}
  await archiveTab.waitFor({state:'hidden'});
  checks.push({kind:'archive',action:i%2?'Cmd+W':'cross',reopened:true});
 }
 await p.evaluate(()=>{history.pushState(history.state,'','/h/srv_An0DcUySXSA0/plugin/paseo-dialogs/surface/archive?param.workspaceId=wks_15d690ea2b3bfb2f');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));});
 await p.getByLabel('Поиск по архиву').waitFor();
 await p.getByTestId(`dialogs-agent-${archived}`).last().click();
 await p.getByText('Разархивировать',{exact:true}).waitFor();
 checks.push({kind:'full-archive-screen',reopened:true});
 for(const width of [1440,800,390]){
  await p.setViewportSize({width,height:900});
  await p.screenshot({path:`${out}/desktop-${width}.png`});
 }
 const inspect=id=>JSON.parse(execFileSync('paseo',['inspect',id,'--host','127.0.0.1:6786','--json'],{encoding:'utf8',timeout:60000}));
 assert.deepEqual(errors,[]);
 assert.equal(inspect(id).Archived,false);assert.equal(inspect(archived).Archived,true);
 writeFileSync('docs/desktop-reopen-0.9.2.json',JSON.stringify({client:'0.13.0',daemon:'0.12.0',electron:await app.evaluate(()=>process.versions.electron),routeCommitDelayMs:250,activeIterations:4,hotReloads:3,crossWorkspace:true,checks},null,2)+'\n');
 console.log('PASS reopen + archive + full archive screen + compact layouts');
}finally{await app.close();}
