import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const host='127.0.0.1:6782', root='http://'+host;
const artifact=new URL('../../artifacts/0.4/',import.meta.url).pathname;
const home='/Users/agmazin/Library/Developer/paseo-dialogs/test-home';
const b=await chromium.launch({headless:true,channel:'chrome'});
try {
 const p=await b.newPage({viewport:{width:1280,height:1000},colorScheme:'dark'});
 await p.goto(root+'/settings/hosts/srv_sFNNmOH9HfpQ/plugins');await p.waitForTimeout(900);
 await p.getByLabel('Действия для paseo-dialogs',{exact:true}).click();await p.getByText('Диалоги',{exact:true}).click();
 const initialSwitch=p.getByRole('switch',{name:'Показывать родной список Workspaces'});
 if(await initialSwitch.getAttribute('aria-checked') !== 'true') {await initialSwitch.click();await p.waitForTimeout(300);}
 await p.goto(root);await p.getByTestId('dialogs-groups').waitFor();await p.waitForTimeout(500);
 const group=p.getByTestId('dialogs-group-wks_131062ce90b161b6');
 const handle=group.getByTestId('dialogs-group-handle');
 const a=await handle.boundingBox();
 await p.mouse.move(a.x+85,a.y+16);await p.mouse.down();await p.mouse.move(a.x+85,a.y-45,{steps:14});await p.waitForTimeout(230);
 await p.screenshot({path:artifact+'07-dark-during.png'});await p.keyboard.press('Escape');await p.mouse.up();
 // Native comparison with the same theme, content and movement delta.
 const native=p.locator('[data-testid^="sidebar-project-row-"]').filter({hasText:'agmazin'});
 const n=await native.boundingBox();await p.mouse.move(n.x+85,n.y+16);await p.mouse.down();await p.mouse.move(n.x+85,n.y-45,{steps:14});await p.waitForTimeout(230);
 await p.screenshot({path:artifact+'08-native-dark-during.png'});await p.keyboard.press('Escape');await p.mouse.up();
 // Check persisted setting and native visibility through the real settings UI.
 await p.goto(root+'/settings/hosts/srv_sFNNmOH9HfpQ/plugins');await p.waitForTimeout(900);
 await p.getByLabel('Действия для paseo-dialogs',{exact:true}).click();await p.getByText('Диалоги',{exact:true}).click();
 const sw=p.getByRole('switch',{name:'Показывать родной список Workspaces'});
 assert.equal(await sw.getAttribute('aria-checked'),'true');await sw.click();await p.waitForTimeout(300);
 await p.goto(root);await p.getByTestId('dialogs-groups').waitFor();await p.waitForTimeout(500);
 assert.equal(await p.getByTestId('sidebar-project-workspace-list-scroll').isVisible(),false);
 assert.equal(await p.getByTestId('sidebar-footer').isVisible(),true);
 await p.screenshot({path:artifact+'09-dark-hidden.png'});
 // A new space appends, archive removes it from disk, reopening the directory appends again.
 const call=(args)=>JSON.parse(execFileSync('paseo',args.concat(['--host',host,'--json']),{encoding:'utf8'}));
 const disk=async()=>JSON.parse(await readFile(home+'/plugin-data/paseo-dialogs/state.json','utf8')).groupOrder;
 const before=await disk();
 const created=call(['workspace','create','--isolation','local','--path','/Users/agmazin/Library/Developer/paseo-dialogs/drag-fixtures/CTG','--title','Новая группа']);
 await p.getByRole('button',{name:'Группа Новая группа',exact:true}).waitFor();
 assert.deepEqual(await disk(),[...before,created.workspaceId]);
 call(['workspace','archive',created.workspaceId]);
 await p.getByRole('button',{name:'Группа Новая группа',exact:true}).waitFor({state:'hidden'});
 assert.deepEqual(await disk(),before);
 await writeFile(artifact+'extra-result.json',JSON.stringify({newWorkspaceAppended:true,archivedRemoved:true,dark:true,nativeHidden:true}));
 // Render unmodified screenshots side by side for the review attachment.
 const images=await Promise.all(['07-dark-during.png','08-native-dark-during.png'].map(f=>readFile(artifact+f)));
 const compare=await b.newPage({viewport:{width:656,height:1040}});
 await compare.setContent(`<body style="margin:0;background:#181818;color:#ddd;font:14px sans-serif;display:flex;gap:8px">${images.map((image,i)=>`<section style="width:320px;overflow:hidden"><div style="height:40px;display:flex;align-items:center;padding-left:12px">${i?'Родной список Paseo 0.12':'Диалоги 0.4.0'}</div><img style="width:1280px;max-width:none" src="data:image/png;base64,${image.toString('base64')}"></section>`).join('')}</body>`);
 await compare.screenshot({path:artifact+'10-comparison.png'});
 console.log('PASS: dark drag comparison, native toggle/footer, new space append and archive persisted');
} finally {await b.close()}
