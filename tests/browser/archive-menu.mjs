import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const host = '127.0.0.1:6786', id = process.env.ROOT, child = process.env.CHILD;
assert.ok(id && child, 'ROOT and CHILD must be disposable running fixtures on 6786');
const inspect = agentId => JSON.parse(execFileSync('paseo', ['inspect', agentId, '--host', host, '--json'], { encoding: 'utf8' }));
const out = resolve(process.argv[2] || 'docs/shots/0.9.0');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', colorScheme: 'dark' });
  const errors = [], messages = [];
  page.on('pageerror', e => errors.push(e.message));
  let accept = false;
  page.on('dialog', async dialog => { messages.push(dialog.message()); await (accept ? dialog.accept() : dialog.dismiss()); });
  await page.goto(`http://${host}`);
  const row = page.getByTestId(`dialogs-agent-${id}`);
  const group = page.getByTestId('dialogs-group-wks_15d690ea2b3bfb2f');
  await group.waitFor();
  if (!await row.count()) await group.getByRole('button', { name: /^CTG/ }).first().click();
  await row.click();
  await page.getByTestId(`workspace-tab-agent_${id}`).waitFor();
  assert.equal(inspect(id).Status, 'running');
  assert.equal(inspect(child).Status, 'running');
  await row.click({ button: 'right' });
  await page.getByTestId('dialogs-agent-menu').waitFor();
  await page.screenshot({ path: `${out}/context-menu.png` });
  await page.getByTestId('dialogs-agent-menu').getByText('Архивировать', { exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(inspect(id).Archived, false);
  assert.equal(inspect(child).Archived, false);
  assert.match(messages.at(-1), /Агент ещё работает/);
  assert.match(messages.at(-1), /подагенты: 1/);
  await row.hover();
  await row.getByTestId('dialogs-agent-more').click();
  await page.getByTestId('dialogs-agent-menu').waitFor();
  await page.screenshot({ path: `${out}/ellipsis-menu.png` });
  accept = true;
  await page.getByTestId('dialogs-agent-menu').getByText('Архивировать', { exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal(inspect(id).Archived, true);
  assert.equal(inspect(child).Archived, true);
  assert.equal(await page.getByTestId(`workspace-tab-agent_${id}`).count(), 0);
  if (await row.count()) {
    await group.getByText("Архив", { exact: true }).click();
    await page.waitForTimeout(500);
  }
  assert.equal(await row.count(), 0);
  await group.getByText('Архив', { exact: true }).click();
  await row.waitFor();
  await page.screenshot({ path: `${out}/archived.png` });
  await row.click();
  await page.getByText('Разархивировать', { exact: true }).waitFor();
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${out}/archive-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: right-click and ellipsis menu, cancel preserves running root/child, confirmation counts child, archive closes tab and archives child, Archive row opens native restore view');
} finally { await browser.close(); }
