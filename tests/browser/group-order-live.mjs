// Run only against the isolated test daemon; never changes the default home.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const host = '127.0.0.1:6782';
const artifact = new URL('../../artifacts/0.4/', import.meta.url).pathname;
await mkdir(artifact, {recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(`http://${host}`);
  const groups = page.locator('[data-testid="dialogs-groups"] > [data-testid^="dialogs-group-"]');
  await groups.first().waitFor();
  await page.waitForTimeout(600);
  const order = () => groups.evaluateAll(es=>es.map(e=>e.dataset.testid.slice('dialogs-group-'.length)));
  const nativeOrder = () => page.locator('[data-testid^="sidebar-project-row-"]').evaluateAll(es=>es.map(e=>e.dataset.testid));
  const original=await order(), native=await nativeOrder();
  const other = await browser.newPage({viewport:{width:390,height:844}});
  await other.goto(`http://${host}`);
  await other.waitForTimeout(800);
  assert.ok(original.length>=3);
  // Expand agmazin so its terminal travels with the group.
  const ag=page.getByRole('button',{name:'Группа agmazin',exact:true});
  if (!(await page.getByText('Тестовый терминал',{exact:true}).isVisible())) {
    await ag.click(); await page.getByText('Тестовый терминал',{exact:true}).waitFor();
  }
  await page.screenshot({path:artifact+'01-before.png'});
  const from=groups.first(), handle=from.getByTestId('dialogs-group-handle');
  let a=await handle.boundingBox(), z=await groups.last().boundingBox();
  await page.mouse.move(a.x+85,a.y+15);await page.mouse.down();
  await page.mouse.move(a.x+88,a.y+15); // under 6px
  assert.equal(await from.evaluate(e=>e.style.transform), '');
  await page.mouse.move(a.x+85,z.y+z.height-2,{steps:18});await page.waitForTimeout(230);
  assert.ok((await from.evaluate(e=>e.style.transform)).includes('scale(1.02)'));
  assert.equal(await from.evaluate(e=>e.style.opacity), '0.9');
  await page.screenshot({path:artifact+'02-during.png'});
  await page.mouse.up();await page.waitForTimeout(700);
  const moved=[...original.slice(1),original[0]];
  assert.deepEqual(await order(),moved);
  assert.deepEqual(await nativeOrder(),native);
  await other.waitForFunction(expected => {
    const ids = [...document.querySelectorAll('[data-testid="dialogs-groups"] > [data-testid^="dialogs-group-"]')].map(e=>e.dataset.testid.slice('dialogs-group-'.length));
    return JSON.stringify(ids) === JSON.stringify(expected);
  }, moved);
  await other.close();
  assert.ok(await page.getByText('Тестовый терминал',{exact:true}).isVisible(), 'drag must not collapse');
  await page.screenshot({path:artifact+'03-after.png'});
  await page.reload();await groups.first().waitFor();await page.waitForTimeout(400);
  assert.deepEqual(await order(),moved);
  execFileSync('paseo',['plugin','reload','paseo-dialogs','--host',host]);
  await page.reload();await groups.first().waitFor();await page.waitForTimeout(700);
  assert.deepEqual(await order(),moved);
  const disk=JSON.parse(await readFile('/Users/agmazin/Library/Developer/paseo-dialogs/test-home/plugin-data/paseo-dialogs/state.json','utf8'));
  assert.deepEqual(disk.groupOrder,moved);
  // Escape must cancel both persistence and transforms.
  a=await groups.first().getByTestId('dialogs-group-handle').boundingBox();z=await groups.last().boundingBox();
  await page.mouse.move(a.x+85,a.y+15);await page.mouse.down();await page.mouse.move(a.x+85,z.y+z.height-2,{steps:15});
  await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(400);
  assert.deepEqual(await order(),moved);
  assert.equal(await groups.first().evaluate(e=>e.style.transform),'');
  await page.screenshot({path:artifact+'04-escape.png'});
  // A plain click still collapses/expands.
  await ag.click();await page.waitForTimeout(300);assert.equal(await page.getByText('Тестовый терминал',{exact:true}).isVisible(),false);
  await ag.click();await page.getByText('Тестовый терминал',{exact:true}).waitFor();
  // Counter and + never activate a drag.
  const group=page.locator('[data-testid="dialogs-group-wks_131062ce90b161b6"]');
  const counter=group.getByTestId('dialogs-no-drag').first();
  a=await counter.boundingBox();await page.mouse.move(a.x+3,a.y+3);await page.mouse.down();await page.mouse.move(a.x+3,a.y+65,{steps:8});
  assert.equal(await group.evaluate(e=>e.style.transform),'');await page.mouse.up();
  await ag.hover();
  a=await page.getByRole('button',{name:'Добавить в agmazin',exact:true}).boundingBox();
  await page.mouse.move(a.x+10,a.y+10);await page.mouse.down();await page.mouse.move(a.x+10,a.y+75,{steps:8});
  assert.equal(await group.evaluate(e=>e.style.transform),'');await page.mouse.up();
  await ag.hover();await page.getByRole('button',{name:'Добавить в agmazin',exact:true}).click();
  await page.getByTestId('dialogs-menu').waitFor();
  assert.ok(await page.getByText('Агент',{exact:true}).isVisible());
  assert.ok(await page.getByText('Терминал',{exact:true}).isVisible());
  await page.screenshot({path:artifact+'05-menu.png'});
  await page.getByLabel('Закрыть меню',{exact:true}).last().click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
  const menu=page.getByTestId('menu-button'); if(await menu.isVisible()) await menu.click();
  await page.waitForTimeout(400);
  assert.deepEqual(await order(),moved);
  await page.screenshot({path:artifact+'06-compact.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: drag threshold, group contents, independent order, persistence/page/plugin reload, Escape, click, counter, + menu, compact; no page errors');
} finally { await browser.close(); }
