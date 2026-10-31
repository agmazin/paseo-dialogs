export type DialogLoadState = "connecting" | "loading" | "refreshing" | "error" | "stale-error" | "ready";

export function dialogLoadState(input: {
  connected: boolean;
  hasData: boolean;
  fetching: boolean;
  error: boolean;
}): DialogLoadState {
  if (!input.connected) return "connecting";
  if (input.fetching) return input.hasData ? "refreshing" : "loading";
  if (input.error) return input.hasData ? "stale-error" : "error";
  return input.hasData ? "ready" : "loading";
}

export function boundedLoad<T>(
  work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeoutMs = 20000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const lifetime = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      lifetime.abort();
      cleanup();
      reject(new Error(message));
    };
    const abort = () => fail("Dialog loading cancelled");
    const timer = setTimeout(() => fail("Dialog loading timed out"), timeoutMs);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (lifetime.signal.aborted) throw new Error("Dialog loading cancelled");
      return work(lifetime.signal);
    }).then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      lifetime.abort();
      cleanup();
      reject(error);
    });
  });
}
