// Isolated AGM-31 fixture only. Start test-home and create the IDs below first.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const host = "127.0.0.1:6782";
const home = "/Users/agmazin/Library/Developer/paseo-dialogs/test-home";
const source = "wks_32452d156e2be400", target = "wks_23eb8948b1bdb7cd";
const id = "c50e4621-ab33-404a-ae63-ad1266e32433";
const codex = "be7712a6-11b9-4a56-b916-97b7ddbfe030";
const artifact = new URL("../../artifacts/0.5/", import.meta.url).pathname;
await mkdir(artifact, { recursive: true });
const c = new DaemonClient({ url: `ws://${host}/ws`, clientId: "agm31-live", clientType: "cli" });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  await c.connect();
  const rpc = (method, input) => c.invokePluginRpc("paseo-dialogs", `dialogs.${method}`, input);
  const get = async agentId => (await c.fetchAgent(agentId)).agent;
  const state = () => rpc("state", {});
  const before = await get(id);
  assert.equal(before.workspaceId, source);
  const initialState = await state();
  assert.ok(initialState.unread[id], "fixture needs an unread completed turn");
  // Provider reload can replace streaming message IDs with persisted JSONL IDs.
  const content = entry => { const { messageId, clientMessageId, ...item } = entry.item; return item; };
  const history = (await c.fetchAgentTimeline(id)).entries.filter(e => e.item.type !== "plugin").map(content);

  // Missing internal package fails before archive, even though the plugin itself
  // remains loaded. Restore config without reload in finally.
  const configPath = `${home}/config.json`, original = await readFile(configPath, "utf8");
  try {
    const config = JSON.parse(original);
    config.plugins["paseo-dialogs"].path = "/nonexistent/agm31-plugin";
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(rpc("move", { agentId: id, sourceId: source, targetId: target }), /Данные не изменены/);
    assert.equal((await get(id)).workspaceId, source);
    assert.equal((await get(id)).archivedAt, before.archivedAt);
  } finally { await writeFile(configPath, original); }

  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://${host}`);
  const row = page.getByTestId(`dialogs-agent-${id}`);
  const group = wid => page.getByTestId(`dialogs-group-${wid}`);
  await row.waitFor();
  const drag = async (destination, escape = false, capture = false) => {
    const a = await row.boundingBox(), b = await group(destination).boundingBox();
    await page.mouse.move(a.x + 100, a.y + 12); await page.mouse.down();
    await page.mouse.move(a.x + 103, a.y + 12);
    assert.equal(await row.evaluate(e => e.style.transform), "");
    await page.mouse.move(a.x + 100, b.y + 12, { steps: 20 });
    assert.match(await row.evaluate(e => e.style.transform), /scale\(1.02\)/);
    assert.ok(await row.evaluate(e => {
      const r = e.getBoundingClientRect();
      return e.contains(document.elementFromPoint(r.left + 90, r.top + r.height / 2));
    }), "dragged row must render above the destination group");
    assert.match(await group(destination).evaluate(e => e.style.outline), /solid/);
    if (capture) await page.screenshot({ path: artifact + "02-during.png" });
    if (escape) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await drag(target, true);
  assert.equal((await get(id)).workspaceId, source);
  assert.equal(await row.evaluate(e => e.style.transform), "");
  await page.screenshot({ path: artifact + "04-escape.png" });

  await page.screenshot({ path: artifact + "01-before.png" });
  await drag(target, false, true);
  await group(target).getByTestId(`dialogs-agent-${id}`).waitFor();
  let moved = await get(id);
  assert.equal(moved.id, before.id); assert.equal(moved.title, before.title);
  assert.deepEqual(moved.labels, before.labels);
  assert.equal((await state()).unread[id], initialState.unread[id]);
  const afterHistory = (await c.fetchAgentTimeline(id)).entries.filter(e => e.item.type !== "plugin").map(content);
  assert.deepEqual(afterHistory, history);
  await page.screenshot({ path: artifact + "03-after.png" });

  // Plain click opens the conversation; moving the open tab follows its workspace.
  await row.click();
  await page.getByText("Запомнил.", { exact: true }).first().waitFor();
  assert.ok((await page.locator("body").innerText()).includes("ЛИМОН"));
  await drag(source);
  await group(source).getByTestId(`dialogs-agent-${id}`).waitFor();
  await page.waitForFunction(wid => location.href.includes(wid), source);
  await page.getByText("Запомнил.", { exact: true }).first().waitFor();
  await page.screenshot({ path: artifact + "05-open-tab.png" });

  // Native import restores an archived row in the destination.
  await c.archiveAgent(id);
  await rpc("preference", { section: "archives", id: source, value: true });
  await page.reload(); await row.waitFor();
  await drag(target);
  await rpc("preference", { section: "archives", id: target, value: true });
  await page.reload(); await group(target).getByTestId(`dialogs-agent-${id}`).waitFor();
  moved = await get(id); assert.equal(moved.workspaceId, target); assert.equal(moved.archivedAt, null);
  await page.screenshot({ path: artifact + "06-archive.png" });

  // Compact layout is display-only, as in 0.4.0.
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByTestId("menu-button"); if (await menu.isVisible()) await menu.click();
  await row.waitFor();
  const a = await row.boundingBox(), b = await group(source).boundingBox();
  await page.mouse.move(a.x + 80, a.y + 12); await page.mouse.down();
  await page.mouse.move(a.x + 80, b.y + 12, { steps: 10 }); await page.mouse.up();
  assert.equal((await get(id)).workspaceId, target);
  await page.screenshot({ path: artifact + "07-compact.png" });

  // Codex uses the exact same runtime RPC.
  await rpc("move", { agentId: codex, sourceId: target, targetId: source });
  assert.equal((await get(codex)).workspaceId, source);
  assert.ok(JSON.stringify((await c.fetchAgentTimeline(codex)).entries).includes("ЛИМОН"));
  assert.deepEqual(errors, []);
  console.log("PASS: missing module, threshold, Escape, highlight, mouse move, identity/history/title/labels/unread, click, open tab, archive, compact, Codex, no page errors");
} finally { await browser.close(); await c.close(); }
