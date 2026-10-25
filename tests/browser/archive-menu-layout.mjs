import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const b = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const [width, colorScheme] of [[1440, 'light'], [800, 'dark'], [390, 'dark']]) {
    const p = await b.newPage({ viewport: { width, height: 900 }, colorScheme, locale: 'ru-RU' });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:6786');
    if (width < 768) await p.getByLabel('Открыть меню', { exact: true }).click();
    await p.getByTestId('dialogs-block').waitFor();
    const row = p.locator('[data-testid^="dialogs-agent-"]').filter({ has: p.getByTestId('dialogs-agent-more') }).first();
    await row.hover();
    await row.getByTestId('dialogs-agent-more').click();
    await p.getByTestId('dialogs-agent-menu').waitFor();
    assert.equal(await p.getByTestId('dialogs-agent-menu').getByText('Архивировать', { exact: true }).count(), 1);
    await p.screenshot({ path: `docs/shots/0.9.0/menu-${width}-${colorScheme}.png` });
    assert.deepEqual(errors, []);
    await p.close();
    console.log(`PASS: menu ${width}px ${colorScheme}`);
  }
} finally { await b.close(); }
