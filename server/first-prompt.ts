import type { PaseoAgentTimelineHandle, PaseoAgentTimelineRefetchOptions } from "@getpaseo/client";

export async function firstPrompt(timeline: PaseoAgentTimelineHandle): Promise<string | null> {
  let cursor: PaseoAgentTimelineRefetchOptions["cursor"];
  let prompt: string | null = null;
  const cursors = new Set<string>();
  for (;;) {
    const page = await timeline.refetch({ direction: "before", limit: 100, ...(cursor ? { cursor } : {}) });
    const first = page.entries.find(entry => entry.item.type === "user_message");
    if (first?.item.type === "user_message") prompt = first.item.text;
    if (!page.hasOlder) return prompt;
    if (!page.startCursor) throw new Error("timeline_missing_cursor");
    const key = JSON.stringify(page.startCursor);
    if (cursors.has(key)) throw new Error("timeline_repeated_cursor");
    cursors.add(key);
    cursor = page.startCursor;
  }
}
