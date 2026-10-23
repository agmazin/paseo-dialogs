import assert from 'node:assert/strict';
import { chromium } from '/Users/agmazin/Library/Developer/paseo-dialogs/node_modules/playwright/index.mjs';
const id = process.env.ARCHIVED ?? '6777ff4c-4c77-4961-af3a-e831b2fa2e0a';
const browser = await chromium.launch({ executablePath: '/Users/agmazin/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
try {
  for (const width of [1440, 800, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'ru-RU', colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:6786');
    if (width < 768) await page.getByLabel('Открыть меню').click();
    await page.getByTestId('dialogs-block').waitFor({ timeout: 30000 });
    const group = page.getByTestId('dialogs-group-wks_15d690ea2b3bfb2f');
    const row = page.getByTestId(`dialogs-agent-${id}`);
    if (!await row.count()) await group.getByText('Архив', { exact: true }).click();
    await row.waitFor();
    await row.click();
    await page.getByText('Разархивировать', { exact: true }).waitFor({ timeout: 15000 });
    assert.ok(await page.getByText('Разархивировать', { exact: true }).isVisible());
    await page.screenshot({ path: `/tmp/dialogs-085-archive-${width}.png` });
    console.log(`PASS: ${width}px archive opens native agent view and Unarchive`);
    await page.close();
  }
} finally { await browser.close(); }
