// Busy-subagents indicator against the accepted mockup.
// PARENT=<agent id of a dialog at rest with running subagents> on the test daemon 6782.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const parent = process.env.PARENT;
assert.ok(parent, "PARENT is required");
const mockup = process.env.MOCKUP ??
  "/Users/agmazin/Yandex.Disk.localized/public/mockups/dialogs-busy-indicator/index.html";
const artifact = new URL("../../artifacts/0.8.0/", import.meta.url).pathname;
await mkdir(artifact, { recursive: true });

// Sizes are unrotated (offsetWidth): the spinner turns. Geometry relative to the icon (16x16) and the row; the same function runs on both pages.
const measure = ({ row, icon, chevron, minis }) => {
  const r = row.getBoundingClientRect(), i = icon.getBoundingClientRect();
  const rel = (e) => {
    const b = e.getBoundingClientRect();
    return { cx: b.x + b.width / 2 - i.x, cy: b.y + b.height / 2 - i.y, w: e.offsetWidth, h: e.offsetHeight };
  };
  return {
    row: { h: r.height, iconX: i.x - r.x, iconY: i.y - r.y, iconW: i.width },
    chevron: chevron ? (() => { const c = chevron.getBoundingClientRect();
      return { x: c.x - r.x, y: c.y - r.y, w: c.width, h: c.height }; })() : null,
    minis: minis.map(({ dot, ring }) => ({ dot: rel(dot), ring: rel(ring) })),
  };
};

const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", colorScheme: "dark" });
  const mock = await ctx.newPage();
  await mock.goto(`file://${mockup}`);
  const expected = await mock.evaluate(`(() => {
    const m = ${measure.toString()};
    const variants = document.querySelectorAll(".variant");
    const minis = (root) => [...root.querySelectorAll(".mini")].map((x) => ({ dot: x.querySelector(".dot"), ring: x.querySelector(".ring") }));
    const parentRow = variants[0].querySelector(".row.parent");
    const sub = variants[1].querySelector(".row.sub");
    return {
      parent: m({ row: parentRow, icon: parentRow.querySelector(".ico"), chevron: parentRow.querySelector(".tw"), minis: minis(parentRow) }),
      sub: m({ row: sub, icon: sub.querySelector(".ico"), minis: minis(sub) }),
    };
  })()`);

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:6782");
  await page.getByTestId("dialogs-scroll").waitFor();
  const row = page.getByTestId(`dialogs-agent-${parent}`);
  await row.waitFor({ timeout: 30_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const live = (sel) => page.evaluate(`(() => {
    const m = ${measure.toString()};
    const host = document.querySelector('[data-testid="${sel}"]');
    const btn = host.querySelector('[role="button"]') ?? host;
    const icon = [...btn.querySelectorAll("div")].find((d) => { const b = d.getBoundingClientRect(); return b.width === 16 && b.height === 16; });
    const badge = host.querySelector('[data-testid="dialogs-subagents-pair"], [data-testid="dialogs-subagent-dot"]');
    const minis = [...badge.children].map((x) => ({ dot: x.children[1], ring: x.children[2] }));
    return { ...m({ row: btn, icon, chevron: host.querySelector('[data-testid="dialogs-subagents-toggle"]'), minis }),
      title: btn.getAttribute("title") };
  })()`);
  const actual = { parent: await live(`dialogs-agent-${parent}`) };
  assert.equal(actual.parent.title, `Работают подагенты: ${Number(process.env.KIDS ?? 2)}`);
  await page.screenshot({ path: `${artifact}collapsed.png` });
  await page.getByTestId(`dialogs-agent-${parent}`).getByTestId("dialogs-subagents-toggle").click();
  await page.waitForTimeout(400);
  const kids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="dialogs-subagent-dot"]')].map((d) => d.closest('[data-testid^="dialogs-agent-"]').getAttribute("data-testid")));
  assert.equal(kids.length, Number(process.env.KIDS ?? 2));
  actual.sub = await live(kids[0]);
  await page.screenshot({ path: `${artifact}expanded.png` });
  const box = await page.getByTestId(`dialogs-agent-${parent}`).boundingBox();
  await page.screenshot({ path: `${artifact}expanded-crop.png`,
    clip: { x: Math.max(0, box.x - 10), y: box.y - 40, width: 320, height: 160 } });

  const diff = [];
  const walk = (a, e, path) => {
    if (typeof e === "number") { if (Math.abs(a - e) > 0.5) diff.push(`${path}: ${a} vs ${e}`); return; }
    if (e && typeof e === "object") for (const k of Object.keys(e)) walk(a?.[k], e[k], `${path}.${k}`);
  };
  walk(actual.parent, expected.parent, "parent");
  walk(actual.sub, { ...expected.sub, chevron: undefined }, "sub");

  // Opening a subagent: same navigation as a dialog.
  const kidTitle = await page.getByTestId(kids[0]).innerText();
  await page.getByTestId(kids[0]).click();
  await page.waitForTimeout(2000);
  const url = page.url();
  // The opened agent's title shows outside the sidebar block (tab and header).
  const opened = await page.evaluate((title) => [...document.querySelectorAll("body *")]
    .filter((e) => e.children.length === 0 && e.textContent.trim() === title && !e.closest('[data-testid="dialogs-block"]'))
    .some((e) => e.getBoundingClientRect().width > 0), kidTitle.split("\n")[0]);
  await page.screenshot({ path: `${artifact}subagent-opened.png` });
  // Collapsed group counts the dialog as "В работе".
  const groupId = await page.getByTestId(`dialogs-agent-${parent}`).evaluate((e) =>
    e.closest('[data-testid^="dialogs-group-"]').dataset.testid);
  const counts = () => page.evaluate((id) => {
    const handle = document.querySelector(`[data-testid="${id}"] [data-testid="dialogs-group-handle"]`);
    return [...handle.querySelectorAll('[aria-label="В работе"]')].map((b) => b.parentElement.textContent);
  }, groupId);
  await page.getByTestId(groupId).getByTestId("dialogs-group-handle").click();
  await page.waitForTimeout(800);
  const group = await counts();
  await page.getByTestId(groupId).getByTestId("dialogs-group-handle").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifact}group-collapsed.png` });
  await page.getByTestId(groupId).getByTestId("dialogs-group-handle").click();
  await writeFile(`${artifact}measure.json`, JSON.stringify({ expected, actual, diff, url, opened, group, errors }, null, 2));
  console.log(JSON.stringify({ diff, url, opened, group, errors }, null, 2));
  assert.deepEqual(diff, []);
  assert.ok(opened, `subagent opened: ${url}`);
  assert.deepEqual(group, ["1"]);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
