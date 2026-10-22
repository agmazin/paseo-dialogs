import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ts = require('typescript');
const source = await readFile(new URL('../../client/web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage();
  await page.setContent('<aside><div data-testid="dialogs-block">Диалоги</div><section id="native"><header>Workspaces<button data-testid="sidebar-display-preferences-menu">Настройки</button></header><div data-testid="sidebar-project-workspace-list-scroll">Проекты</div></section><footer data-testid="sidebar-footer">Подвал</footer></aside>');
  await page.evaluate(code => {
    const exports = {};
    new Function('exports','require',code)(exports, name => name==='react-native' ? {Platform:{OS:'web'}} : {});
    window.hide = exports.hideNativeWorkspaces;
    window.cleanup = window.hide(true);
  }, compiled);
  assert.equal(await page.locator('#native').isVisible(), false);
  assert.equal(await page.getByTestId('dialogs-block').isVisible(), true);
  assert.equal(await page.getByTestId('sidebar-footer').isVisible(), true);
  await page.locator('#native').evaluate(e=>e.style.display='flex');
  await page.waitForFunction(()=>document.querySelector('#native').style.display==='none');
  await page.getByTestId('sidebar-project-workspace-list-scroll').evaluate(e=>e.removeAttribute('data-testid'));
  await page.waitForFunction(()=>document.querySelector('#native').style.display!=='none');
  await page.locator('#native > div').evaluate(e=>e.setAttribute('data-testid','sidebar-project-workspace-list-scroll'));
  await page.waitForFunction(()=>document.querySelector('#native').style.display==='none');
  await page.locator('#native').evaluate(e=>e.outerHTML=e.outerHTML.replace('display: none !important;',''));
  await page.waitForFunction(()=>document.querySelector('#native').style.display==='none');
  await page.evaluate(()=>window.cleanup());
  assert.equal(await page.locator('#native').isVisible(), true);
  await page.evaluate(()=>{window.cleanup=window.hide(false)});
  assert.equal(await page.locator('#native').isVisible(), true);
  // A changed host layout must never hide our block or the footer.
  for (const marker of ['dialogs-block', 'sidebar-footer']) {
    await page.evaluate(marker => {
      window.cleanup();
      const sentinel = document.createElement('div');
      sentinel.dataset.testid = marker;
      sentinel.id = 'unsafe-child';
      document.querySelector('#native').append(sentinel);
      window.cleanup = window.hide(true);
    }, marker);
    assert.equal(await page.locator('#native').isVisible(), true);
    await page.locator('#unsafe-child').evaluate(e=>e.remove());
    await page.waitForFunction(()=>document.querySelector('#native').style.display==='none');
    await page.evaluate(()=>window.cleanup());
  }
  // Missing either marker must leave the tree visible.
  await page.getByTestId('sidebar-display-preferences-menu').evaluate(e=>e.remove());
  await page.evaluate(()=>{window.cleanup();window.cleanup=window.hide(true)});
  assert.equal(await page.locator('#native').isVisible(), true);
  await page.evaluate(()=>window.cleanup());
  await page.setContent('<aside style="height:700px;display:flex;flex-direction:column"><div id="header"><div id="group" style="display:flex;flex-direction:column;border-bottom:1px solid"><div data-testid="dialogs-block"><div data-testid="dialogs-scroll">Диалоги</div></div><button>Канбан</button></div></div><div id="native-wrapper"><section><button data-testid="sidebar-display-preferences-menu">Вид</button><div data-testid="sidebar-project-workspace-list-scroll"></div></section></div><footer data-testid="sidebar-footer" style="border-top:1px solid"><div id="empty-rows"><div></div></div><div data-testid="sidebar-footer-separator" style="border-bottom:1px solid"></div><button>Настройки</button></footer></aside>');
  await page.evaluate(() => { window.cleanup = window.hide(true); });
  assert.equal(await page.locator('#native-wrapper').isVisible(), false);
  assert.equal(await page.locator('#empty-rows').isVisible(), false);
  assert.equal(await page.getByTestId('sidebar-footer-separator').isVisible(), false);
  assert.equal(await page.locator('#group').evaluate(e => getComputedStyle(e).borderBottomWidth), '0px');
  assert.equal(await page.getByTestId('sidebar-footer').evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
  await page.locator('#empty-rows > div').evaluate(e => e.innerHTML = '<button>Новый пункт</button>');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#empty-rows')).display !== 'none');
  assert.equal(await page.getByTestId('sidebar-footer-separator').isVisible(), true);
  await page.evaluate(() => window.cleanup());
  assert.equal(await page.locator('#native-wrapper').isVisible(), true);
  assert.equal(await page.locator('#group').evaluate(e => getComputedStyle(e).borderBottomWidth), '1px');
  assert.equal(await page.getByTestId('dialogs-scroll').evaluate(e => e.style.maxHeight), '');
  console.log('PASS: exact markers, footer isolation, rerender, marker loss, cleanup, toggle, single separator, live footer contribution');
} finally { await browser.close(); }
