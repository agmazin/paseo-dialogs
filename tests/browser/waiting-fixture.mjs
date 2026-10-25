import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const home='/Users/agmazin/Library/Developer/paseo-dialogs-waiting-home';
const plugin='/Users/agmazin/Library/Developer/paseo-dialogs-waiting-plugin';
const workspaceId=JSON.parse(readFileSync(`${home}/projects/workspaces.json`)).find(w=>!w.archivedAt).workspaceId;
const base={provider:'codex',workspaceId,createdAt:'2026-10-25T18:00:00.000Z'};
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007'];
const specs=[
 {title:'AGM-99: Ожидание в ветке',status:'running'},
 {title:'AGM-99-1: Промежуточный',status:'idle',parentAgentId:ids[0]},
 {title:'AGM-99-1-1: Разрешение',status:'running',parentAgentId:ids[1],pendingPermissions:[{id:'test',toolName:'CodexBash'}]},
 {title:'AGM-99-2: Вопрос',status:'idle',parentAgentId:ids[0],labels:{kanban:'ask'}},
 {title:'AGM-99-3: Приёмка',status:'running',parentAgentId:ids[0],labels:{kanban:'review'}},
 {title:'AGM-99-4: Работает',status:'running',parentAgentId:ids[0]},
 {title:'AGM-98: Собственный вопрос',status:'idle',labels:{kanban:'ask'}},
];
writeFileSync(`${home}/waiting-fixture.json`,JSON.stringify(specs.map((a,i)=>({...base,id:ids[i],...a}))));
let source=readFileSync(resolve('server/runtime.ts'),'utf8');
source=source.replace('const rows: FullAgent[] = [];',`return JSON.parse(await readFile("${home}/waiting-fixture.json", "utf8")) as FullAgent[];\n    const rows: FullAgent[] = [];`);
writeFileSync(`${plugin}/server/runtime.ts`,source);
console.log(JSON.stringify({workspaceId,ids}));
