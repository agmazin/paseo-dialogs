type Marker = { type: string; id?: string };
type RestorePorts = {
  unread: Record<string, string>;
  stopped(): boolean;
  signal?: AbortSignal;
  read(agentId: string): Promise<readonly Marker[]>;
  append(agentId: string, token: string): Promise<void>;
  save(): Promise<void>;
  report(): void;
};

class RestoreTimeout extends Error {}

function bounded<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(new RestoreTimeout()); };
    const timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    work.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

export async function restoreUnreadMarkers(
  ports: RestorePorts,
  options = { requestTimeoutMs: 5000, totalTimeoutMs: 10000 },
): Promise<void> {
  const entries = Object.entries(ports.unread).filter(([, token]) => token);
  const deadline = Date.now() + options.totalTimeoutMs;
  let cursor = 0;
  let changed = false;
  const current = (id: string, token: string) => !ports.stopped() && ports.unread[id] === token;
  const worker = async () => {
    while (!ports.stopped() && cursor < entries.length && Date.now() < deadline) {
      const [id, token] = entries[cursor++];
      if (!current(id, token)) continue;
      const timeout = () => Math.max(1, Math.min(options.requestTimeoutMs, deadline - Date.now()));
      try {
        const history = await bounded(ports.read(id), timeout(), ports.signal);
        if (!current(id, token)) continue;
        if (!history.some((item) => item.type === "plugin" && item.id === `read-${token}`)) {
          await bounded(ports.append(id, token), timeout(), ports.signal);
        }
      } catch (error) {
        if (error instanceof RestoreTimeout) {
          if (current(id, token)) ports.report();
          return;
        }
        if (!current(id, token)) continue;
        delete ports.unread[id];
        changed = true;
        ports.report();
      }
    }
  };
  await Promise.all([worker(), worker()]);
  if (changed && !ports.stopped()) await ports.save();
}
