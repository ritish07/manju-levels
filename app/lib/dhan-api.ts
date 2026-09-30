import { dhanHeaders, invalidateToken } from './dhan-auth';
let lastChain = 0;
let lastQuote = 0;
let chartStartQueue: Promise<unknown> = Promise.resolve();
let quoteStartQueue: Promise<unknown> = Promise.resolve();
let chainStartQueue: Promise<unknown> = Promise.resolve();
let lastChart = 0;
const cache = new Map<string, {expires: number; staleExpires: number; promise: Promise<any>}>();
export async function dhan(path: string, body: object, cacheMs?: number): Promise<any> {
  const key = path + JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  if (hit && hit.staleExpires > Date.now()) {
    // Return the last verified snapshot immediately, then refresh it in the
    // background. The live quote path continues to update the final candle.
    cache.delete(key);
    void dhan(path, body, cacheMs).catch(() => {});
    return hit.promise;
  }
  const isChart = path.startsWith('/charts/');
  const isQuote = path.startsWith('/marketfeed/');
  const isOptionChain = path === '/optionchain';
  // Chart requests are start-rate-limited, but their network waits are allowed
  // to overlap. Serializing the entire requests made a three-chart snapshot
  // take up to three Dhan timeouts during an asset switch.
  const gate = isChart
    ? chartStartQueue.catch(() => {}).then(async () => {
      const delay = 250 - (Date.now() - lastChart);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastChart = Date.now();
    })
    : isQuote
      ? quoteStartQueue.catch(() => {}).then(async () => {
        const delay = 1050 - (Date.now() - lastQuote);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        lastQuote = Date.now();
      })
      : isOptionChain
        ? chainStartQueue.catch(() => {}).then(async () => {
          const delay = 3100 - (Date.now() - lastChain);
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          lastChain = Date.now();
        })
        : Promise.resolve();
  if (isChart) chartStartQueue = gate;
  if (isQuote) quoteStartQueue = gate;
  if (isOptionChain) chainStartQueue = gate;
  const task = gate.then(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = await dhanHeaders();
      const response = await fetch(`https://api.dhan.co/v2${path}`, {method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(25000)});
      const data = await response.json().catch(() => ({}));
      const message = data?.remarks?.error_message || data?.errorMessage || `Dhan HTTP ${response.status}`;
      const code = String(data?.remarks?.error_code || data?.errorCode || '');
      const rejected = ['DH-901', '807', '808', '809'].includes(code) || /invalid token|token.*(?:invalid|expired)|invalid authentication/i.test(message);
      if (rejected) {
        invalidateToken(headers['access-token']);
        if (attempt === 0) continue;
      }
      if (!response.ok || data?.status === 'failure' || rejected) throw new Error(message);
      return data;
    }
  });
  // Historical candles are immutable except for the currently-forming bar,
  // which the lightweight tick endpoint updates in the browser. Keep chart
  // history warm so revisiting or prefetching a contract does not repeatedly
  // pay Dhan's REST latency.
  const ttl = cacheMs ?? (path.includes('charts') ? 300000 : path.includes('expiry') ? 300000 : path === '/optionchain' ? 12000 : 5000);
  const staleTtl = path.includes('charts') ? 1800000 : path === '/optionchain' ? 45000 : ttl;
  if (ttl > 0) cache.set(key, { expires: Date.now() + ttl, staleExpires: Date.now() + staleTtl, promise: task });
  task.catch(() => {
    if (cache.get(key)?.promise === task) cache.delete(key);
  });
  if (cache.size > 300) for (const [k,v] of cache) if(v.staleExpires < Date.now()) cache.delete(k);
  return task;
}
