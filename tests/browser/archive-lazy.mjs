import { open } from './lib.mjs';
import { execFileSync } from 'node:child_process';
const { b, p } = await open(1200, 900);
await p.goto('http://127.0.0.1:6786'); await p.waitForTimeout(3000);
const grp = p.getByTestId('dialogs-group-wks_c8ebc516f2e49bfd');
console.log('archive line', await grp.getByText('Архив').count());
await grp.getByText('Архив').first().click(); await p.waitForTimeout(1500);
console.log('archived row visible', await grp.getByText('Итоги дебиторки в воронке - посчитаны').count());
// archive a live CTG chat -> count moves
const before = await p.getByTestId('dialogs-group-wks_15d690ea2b3bfb2f').innerText();
execFileSync('paseo', ['archive', 'dc43c066-b3f4-4d27-bbfc-26eae7ce3bac', '--host', '127.0.0.1:6786']);
await p.waitForTimeout(2500);
const after = await p.getByTestId('dialogs-group-wks_15d690ea2b3bfb2f').innerText();
console.log('CTG has "Проверка скорости" before/after:', before.includes('Проверка скорости'), after.includes('Проверка скорости'), '| archive count text:', (after.match(/Архив\s*\n?\s*(\d+)/) || [])[1]);
await p.screenshot({ path: '/tmp/kbt/ar.png' });
await b.close();
