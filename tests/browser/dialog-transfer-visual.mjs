// Isolated existing AGM-31 fixtures; drag is always cancelled, no provider turns.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('artifacts/0.5.1',{recursive:true});
const b=await chromium.launch({headless:true,channel:'chrome'});
try{for(const theme of ['light','dark']){
 const p=await b.newPage({viewport:{width:1400,height:950},colorScheme:theme});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:6782');
 const row=p.getByTestId('dialogs-agent-c50e4621-ab33-404a-ae63-ad1266e32433');await row.waitFor();
 const source=await row.evaluate(e=>e.closest('[data-testid^="dialogs-group-wks_"]').dataset.testid);
 const target=p.locator(`[data-testid^="dialogs-group-wks_"]:not([data-testid="${source}"])`).first();
 const header=target.getByTestId('dialogs-group-handle');
 const r=await row.boundingBox(),h=await header.boundingBox();
 await p.mouse.move(r.x+110,r.y+12);await p.mouse.down();await p.mouse.move(r.x+110,h.y+12,{steps:15});
 const visual=await row.evaluate(e=>({transform:e.style.transform,opacity:e.style.opacity,radius:e.style.borderRadius,buttons:[...e.querySelectorAll('[role="button"]')].map(b=>({outline:getComputedStyle(b).outlineStyle,shadow:getComputedStyle(b).boxShadow}))}));
 assert.match(visual.transform,/scale\(1.02\)/);assert.equal(visual.opacity,'0.9');assert.equal(visual.radius,'9px');
 for(const v of visual.buttons){assert.equal(v.outline,'none');assert.equal(v.shadow,'none');}
 assert.ok((await row.boundingBox()).y>=h.y+h.height,'destination heading stays clear');
 assert.equal(await target.evaluate(e=>e.style.borderRadius),'9px');
 assert.equal(await target.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 await p.screenshot({path:`artifacts/0.5.1/${theme}-during.png`});
 await p.keyboard.press('Escape');await p.mouse.up();assert.equal(await row.evaluate(e=>e.style.transform),'');
 assert.equal(await target.evaluate(e=>e.style.backgroundColor),'');assert.deepEqual(errors,[]);
 await p.close();
}console.log('PASS light/dark: raised row, no ring, rounded background target, heading clear, Escape restores styles, no page errors');}finally{await b.close();}
