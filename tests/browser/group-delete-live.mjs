// 0.6.0: group menu (rename, delete) plus 0.5.2 regressions. Isolated test daemon only.
// PLAYWRIGHT=/path/to/playwright/index.mjs node tests/browser/group-delete-live.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const host = "127.0.0.1:6782";
const home = "/Users/agmazin/Library/Developer/paseo-dialogs/test-home";
const artifact = new URL("../../artifacts/0.6/", import.meta.url).pathname;
await mkdir(artifact, { recursive: true });
const paseo = (...args) => execFileSync("paseo", [...args, "--host", host], { encoding: "utf8" });
const stateFile = async () => JSON.parse(await readFile(`${home}/plugin-data/paseo-dialogs/state.json`, "utf8"));
const [EMPTY, FULL, OTHER] = ["Удаление пустая", "Удаление два диалога", "Перенос цель"];
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://${host}`);
  await page.getByText("Диалоги", { exact: true }).first().waitFor();
  const groups = page.locator('[data-testid="dialogs-groups"] > [data-testid^="dialogs-group-"]');
  const handle = name => page.getByRole("button", { name: `Группа ${name}`, exact: true });
  const group = name => groups.filter({ has: handle(name) });
  const groupId = async name => (await group(name).getAttribute("data-testid")).slice("dialogs-group-".length);
  const agentIds = name => group(name).locator('[data-testid^="dialogs-agent-"]')
    .evaluateAll(es => es.map(e => e.dataset.testid.slice("dialogs-agent-".length)));
  const names = () => groups.evaluateAll(es => es.map(e => e.querySelector('[data-testid="dialogs-group-handle"]').getAttribute("aria-label")));
  const menu = async name => {
    await handle(name).hover();
    await page.getByRole("button", { name: `Действия группы ${name}`, exact: true }).click();
    await page.getByTestId("dialogs-group-menu").waitFor();
  };
  const confirmNext = accept => new Promise(resolve => page.once("dialog", async d => {
    const text = d.message(); await (accept ? d.accept() : d.dismiss()); resolve(text);
  }));

  await page.waitForTimeout(1500);
  for (const name of [EMPTY, FULL, OTHER]) {
    if (await handle(name).count()) continue; // Rerun after an interrupted pass.
    await page.getByRole("button", { name: "Новая папка", exact: true }).click();
    await page.getByLabel("Название", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await handle(name).waitFor();
  }
  const addAgent = async name => {
    const before = await agentIds(name);
    await handle(name).hover();
    await page.getByRole("button", { name: `Добавить в ${name}`, exact: true }).click();
    await page.getByTestId("dialogs-menu").getByRole("button", { name: "Агент", exact: true }).click();
    await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n,
      [`[data-testid="dialogs-group-${await groupId(name)}"] [data-testid^="dialogs-agent-"]`, before.length]);
    return (await agentIds(name)).find(id => !before.includes(id));
  };
  const first = await addAgent(FULL), second = await addAgent(OTHER);
  paseo("agent", "update", first, "--name", "Удаление 1");
  paseo("agent", "update", second, "--name", "Удаление 2");

  // 0.5.2 regressions: completed turn gives unread, open, transfer, archive, order, collapse.
  // Another workspace, reloaded so the deck does not keep the new chat mounted (an open chat is read at once).
  await page.getByTestId(`dialogs-agent-${first}`).click();
  await page.waitForURL(/workspace/); await page.waitForTimeout(800);
  await page.reload(); await handle(OTHER).waitFor(); await page.waitForTimeout(1500);
  paseo("send", second, "Ответь одним словом: готово");
  paseo("wait", second);
  const secondRow = page.getByTestId(`dialogs-agent-${second}`);
  await secondRow.getByLabel("На проверку", { exact: true }).waitFor({ timeout: 30000 });
  await secondRow.click();
  await page.waitForURL(/agent|workspace/);
  const r = await secondRow.boundingBox(), t = await handle(FULL).boundingBox();
  await page.mouse.move(r.x + 100, r.y + 12); await page.mouse.down();
  await page.mouse.move(r.x + 100, t.y + 12, { steps: 15 }); await page.mouse.up();
  await group(FULL).getByTestId(`dialogs-agent-${second}`).waitFor({ timeout: 60000 });
  paseo("archive", first);
  await group(FULL).getByRole("button", { name: "Архив 1", exact: true }).waitFor({ timeout: 10000 });
  const order = await names();
  const a = await handle(EMPTY).boundingBox(), z = await groups.last().boundingBox();
  await page.mouse.move(a.x + 85, a.y + 15); await page.mouse.down();
  await page.mouse.move(a.x + 85, z.y + z.height - 2, { steps: 18 }); await page.mouse.up();
  const moved = [...order.filter(n => n !== `Группа ${EMPTY}`), `Группа ${EMPTY}`];
  await page.waitForTimeout(700);
  assert.deepEqual(await names(), moved);
  await handle(OTHER).click(); await handle(OTHER).click();
  await page.reload(); await handle(EMPTY).waitFor();
  assert.deepEqual(await names(), moved);
  await page.screenshot({ path: `${artifact}01-before-1440.png` });

  // Rename through the group menu.
  await menu(OTHER);
  await page.screenshot({ path: `${artifact}02-menu-1440.png` });
  await page.getByRole("button", { name: "Переименовать", exact: true }).click();
  await page.getByLabel("Название группы", { exact: true }).fill("Переименовано");
  await page.screenshot({ path: `${artifact}03-rename-1440.png` });
  await page.getByRole("button", { name: "Переименовать", exact: true }).last().click();
  await handle("Переименовано").waitFor();

  // Delete an empty group from the "..." button.
  const emptyId = await groupId(EMPTY), fullId = await groupId(FULL);
  await menu(EMPTY);
  let shown = confirmNext(true);
  await page.getByRole("button", { name: "Удалить группу", exact: true }).click();
  const emptyText = await shown;
  assert.match(emptyText, new RegExp(`Удалить группу "${EMPTY}"\\?`));
  assert.match(emptyText, /Группа пуста/);
  await handle(EMPTY).waitFor({ state: "detached" });

  // Cancel on a group with dialogs, opened by right click, changes nothing.
  await handle(FULL).click({ button: "right" });
  await page.getByTestId("dialogs-group-menu").waitFor();
  shown = confirmNext(false);
  await page.getByRole("button", { name: "Удалить группу", exact: true }).click();
  const fullText = await shown;
  assert.match(fullText, /Диалогов в группе: 2/);
  await page.waitForTimeout(1500);
  assert.ok(await handle(FULL).isVisible());
  assert.equal(await group(FULL).getByTestId(`dialogs-agent-${second}`).count(), 1);

  // Confirm deletion: the group disappears, its dialogs stay in native History.
  await handle(FULL).click({ button: "right" });
  shown = confirmNext(true);
  await page.getByRole("button", { name: "Удалить группу", exact: true }).click();
  await shown;
  await handle(FULL).waitFor({ state: "detached" });
  await page.waitForURL(url => !url.pathname.includes(fullId)); // The open group is left first.
  const agents = JSON.parse(paseo("ls", "-a", "--json"));
  for (const id of [first, second]) assert.ok(agents.some(x => x.id === id), `agent ${id} must still exist`);
  await page.reload(); await handle("Переименовано").waitFor(); await page.waitForTimeout(1000);
  assert.equal(await handle(EMPTY).count(), 0);
  assert.equal(await handle(FULL).count(), 0);
  const state = await stateFile();
  assert.ok(!state.groupOrder.includes(emptyId) && !state.groupOrder.includes(fullId));
  await page.screenshot({ path: `${artifact}04-after-1440.png` });
  await page.getByText("История", { exact: true }).first().click();
  await page.getByText("Удаление 1", { exact: true }).first().waitFor();
  await page.getByText("Удаление 2", { exact: true }).first().waitFor();
  await page.screenshot({ path: `${artifact}05-history-1440.png` });

  // Phone layout: "..." is always visible and opens the host popover.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", e => errors.push(e.message));
  await phone.goto(`http://${host}`);
  await phone.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await phone.getByRole("button", { name: "Действия группы Переименовано", exact: true }).first().click();
  await phone.getByTestId("dialogs-group-menu").waitFor();
  await phone.waitForTimeout(800); // Sheet animation.
  await phone.screenshot({ path: `${artifact}06-menu-390.png` });
  await phone.close();

  // Cleanup through the same menu.
  await page.goto(`http://${host}`);
  await menu("Переименовано");
  shown = confirmNext(true);
  await page.getByRole("button", { name: "Удалить группу", exact: true }).click();
  await shown;
  await handle("Переименовано").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS: menu, rename, empty delete, cancel, delete with 2 dialogs, history, reload, groupOrder, 0.5.2 regressions");
} finally { await browser.close(); }
