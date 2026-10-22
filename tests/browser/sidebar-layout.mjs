import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const artifact = new URL("../../artifacts/0.7.0/", import.meta.url).pathname;
await mkdir(artifact, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:6782");
  await page.getByTestId("dialogs-scroll").waitFor();
  const measurements = [];
  for (const height of [900, 700, 900]) {
    await page.setViewportSize({ width: 1440, height });
    await page.waitForTimeout(700);
    const result = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="dialogs-block"]');
      const scroll = document.querySelector('[data-testid="dialogs-scroll"]');
      const footer = document.querySelector('[data-testid="sidebar-footer"]');
      const kanban = [...document.querySelectorAll('[role="button"]')].find(e => e.textContent === "Канбан");
      const visible = el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight &&
          el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      };
      return { height: innerHeight, block: block.getBoundingClientRect().toJSON(),
        footer: footer.getBoundingClientRect().toJSON(), kanban: kanban.getBoundingClientRect().toJSON(),
        scroll: { client: scroll.clientHeight, content: scroll.scrollHeight },
        kanbanClickable: visible(kanban),
        footerClickable: [...footer.querySelectorAll('[role="button"]')].filter(e => e.getBoundingClientRect().width > 0).every(visible),
        footerButtons: footer.querySelectorAll('[role="button"]').length };
    });
    assert.ok(result.block.bottom <= result.kanban.top, "Канбан должен идти после блока");
    assert.ok(result.kanban.bottom <= result.footer.top, "Канбан должен быть выше нижнего меню");
    assert.ok(result.footer.bottom <= height, "нижнее меню должно помещаться в окно");
    assert.ok(result.kanbanClickable && result.footerClickable && result.footerButtons > 0);
    assert.ok(result.scroll.content > result.scroll.client, "нужен длинный список фикстур");
    await page.getByTestId("dialogs-scroll").hover();
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(200);
    assert.ok(await page.getByTestId("dialogs-scroll").evaluate(e => e.scrollTop) > 0);
    await page.getByTestId("dialogs-scroll").evaluate(e => e.scrollTop = 0);
    assert.equal(await page.getByTestId("sidebar-global-new-workspace").innerText(), "Новая папка");
    await page.screenshot({ path: `${artifact}after-1440x${height}.png` });
    measurements.push(result);
  }
  await page.getByRole("button", { name: "Новая папка", exact: true }).last().click();
  assert.ok(await page.getByText("Новая папка", { exact: true }).count() >= 2);
  await page.screenshot({ path: `${artifact}after-create.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await page.waitForURL(/surface\/board/);
  await page.getByTestId("sidebar-footer").getByRole("button", { name: "Настройки", exact: true }).click();
  await page.waitForURL(/settings/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${artifact}after-footer-click.png` });
  await writeFile(`${artifact}after-dom.json`, JSON.stringify(measurements, null, 2));
  const phone = await browser.newPage({ viewport: { width: 390, height: 700 }, locale: "ru-RU", colorScheme: "dark" });
  phone.on("pageerror", e => errors.push(e.message));
  await phone.goto("http://127.0.0.1:6782");
  await phone.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await phone.getByTestId("dialogs-scroll").waitFor();
  await phone.waitForTimeout(700);
  const phoneFooter = await phone.getByTestId("sidebar-footer").boundingBox();
  const phoneBlock = await phone.getByTestId("dialogs-block").boundingBox();
  assert.ok(phoneFooter.y + phoneFooter.height <= 700);
  assert.ok(phoneBlock.y + phoneBlock.height < phoneFooter.y);
  await phone.getByTestId("dialogs-scroll").evaluate(e => e.scrollTop = 300);
  assert.ok(await phone.getByTestId("dialogs-scroll").evaluate(e => e.scrollTop) > 0);
  await phone.screenshot({ path: `${artifact}after-390x700-dark.png` });
  await phone.close();
  assert.deepEqual(errors, []);
  console.log("PASS: 900/700/900, internal scroll, sibling and footer hit tests, Канбан click, folder labels", measurements);
} finally { await browser.close(); }
