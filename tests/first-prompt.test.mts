import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPrompt } from '../server/first-prompt.ts';

test('first prompt paginates backward and fails safely on an invalid cursor', async () => {
  const calls: any[] = [];
  const timeline: any = { refetch: async (options: any) => {
    calls.push(options);
    return options.cursor
      ? { entries: [{ item: { type: 'user_message', text: 'Первый запрос' } }], hasOlder: false }
      : { entries: [{ item: { type: 'user_message', text: 'Следующая тема' } }], hasOlder: true, startCursor: { seq: 100, epoch: 'epoch' } };
  } };
  assert.equal(await firstPrompt(timeline), 'Первый запрос');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].cursor, { seq: 100, epoch: 'epoch' });
  assert.equal(await firstPrompt({ refetch: async () => ({ entries: [], hasOlder: false }) } as any), null);
  await assert.rejects(firstPrompt({ refetch: async () => ({ entries: [], hasOlder: true }) } as any), /missing_cursor/);
  await assert.rejects(firstPrompt({ refetch: async () => ({ entries: [], hasOlder: true, startCursor: { seq: 100, epoch: 'epoch' } }) } as any), /repeated_cursor/);
});
