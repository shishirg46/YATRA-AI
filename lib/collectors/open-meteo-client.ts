const queue: Array<() => Promise<void>> = [];
let processing = false;
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1100;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    await task();
    lastRequestTime = Date.now();
  }
  processing = false;
}

export async function openMeteoFetch(url: string, retries = 2): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await new Promise<Response | null>((resolve) => {
      queue.push(async () => {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
            headers: { Accept: "application/json" },
          });

          if (res.status === 429 && attempt < retries) {
            const wait = Math.min(2000 * (attempt + 1), 8000);
            await new Promise((r) => setTimeout(r, wait));
            resolve(null);
            return;
          }

          resolve(res);
        } catch {
          resolve(null);
        }
      });
      processQueue();
    });

    if (result) return result;
  }

  return null;
}
