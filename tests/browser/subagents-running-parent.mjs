import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from '/Users/agmazin/Library/Developer/paseo-dialogs/node_modules/playwright/index.mjs';
const home = '/Users/agmazin/Library/Developer/paseo-kanban/test-home';
const parent = process.env.PARENT ?? 'c00dbb33-83ee-419e-b82f-cf21d4e400ca';
const child = process.env.CHILD;
assert.ok(child, 'CHILD is required: running test subagent');
const cli = (...args) => execFileSync('/opt/homebrew/bin/paseo', [...args, '--home', home], { encoding: 'utf8' });
const browser = await chromium.launch({ executablePath: '/Users/agmazin/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:6786');
  const row = page.getByTestId(`dialogs-agent-${parent}`);
  const toggle = row.getByTestId('dialogs-subagents-toggle');
  await toggle.waitFor({ timeout: 30000 });
  assert.equal(await row.getByTestId('dialogs-subagents-pair').count(), 1);
  await toggle.click();
  await page.getByTestId(`dialogs-agent-${child}`).waitFor();
  cli('send', parent, 'Выполни только Bash команду ping -c 150 127.0.0.1 и дождись окончания. Файлы не меняй.', '--no-wait');
  for (let i = 0; i < 30; i++) {
    if (await row.getByTestId('dialogs-subagents-pair').count() === 0) break;
    await page.waitForTimeout(500);
  }
  assert.equal(await row.getByTestId('dialogs-subagents-pair').count(), 0, 'parent has its own working badge');
  assert.equal(await toggle.getAttribute('aria-label'), 'Скрыть подагентов');
  const agents = JSON.parse(cli('ls', '--json'));
  assert.equal(agents.find(a => a.id === parent)?.status, 'running');
  assert.equal(agents.find(a => a.id === child)?.status, 'running');
  await page.screenshot({ path: '/tmp/dialogs-085-parent-expanded.png' });
  await toggle.click();
  assert.equal(await page.getByTestId(`dialogs-agent-${child}`).count(), 0);
  assert.equal(await toggle.count(), 0, 'collapsed running parent has no toggle');
  await page.screenshot({ path: '/tmp/dialogs-085-parent.png' });
  console.log('PASS: expanded running parent retains collapse; collapsed running parent keeps own badge');
} finally { await browser.close(); }
