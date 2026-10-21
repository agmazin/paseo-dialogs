import { open } from './lib.mjs';
import { execFileSync } from 'node:child_process';
const { b, p } = await open(390, 844);
let fetches = 0;
p.on('websocket', ws => ws.on('framesent', f => { const t = typeof f.payload === 'string' ? f.payload : ''; if (/fetch_agents_request|"fetch_agents"/.test(t)) fetches++; }));
await p.goto('http://127.0.0.1:6786'); await p.waitForTimeout(4000);
await p.getByLabel('Открыть меню').click(); await p.waitForTimeout(1500);
const start = fetches;
// fold and unfold a group: must react without waiting for the daemon
const group = p.getByRole('button', { name: /Группа CTG/ }).first();
const before = await p.getByText('Оценки', { exact: true }).count();
const t0 = Date.now(); await group.click();
await p.waitForFunction(() => ![...document.querySelectorAll('div')].some(n => n.textContent === 'Оценки' && n.getClientRects().length), null, { timeout: 5000 });
console.log('fold took ms', Date.now() - t0, 'visible before', before);
const t1 = Date.now(); await group.click();
await p.getByText('Оценки', { exact: true }).first().waitFor({ timeout: 5000 });
console.log('unfold took ms', Date.now() - t1);
// a new agent appears from the event stream
const id = JSON.parse(execFileSync('paseo', ['run', '--no-wait', '--json', '--host', '127.0.0.1:6786', '--workspace', 'wks_15d690ea2b3bfb2f', '--cwd', '/Users/agmazin/Library/Developer/paseo-kanban/fixtures/CTG', '--provider', 'claude', '--model', 'claude-haiku-5-5', '--mode', 'bypassPermissions', '--title', 'Проверка скорости', 'Ответь одним словом: ок'], { encoding: 'utf8', env: { ...process.env, PASEO_AGENT_ID: '', PASEO_AGENT_CWD: '' } })).agentId;
const t2 = Date.now(); await p.getByText('Проверка скорости', { exact: true }).first().waitFor({ timeout: 15000 });
console.log('new agent shown after ms', Date.now() - t2);
await p.waitForTimeout(20000);
console.log('fetch_agents requests during ~30 s:', fetches - start);
await p.screenshot({ path: '/tmp/kbt/p1.png' });
console.log('agent', id);
await b.close();
