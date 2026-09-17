import { dhanHeaders, invalidateToken } from './dhan-auth';
let queue: Promise<unknown> = Promise.resolve();
let lastChain = 0;
let chartQueue: Promise<unknown> = Promise.resolve();
let lastChart = 0;
const cache = new Map<string, {expires: number; promise: Promise<any>}>();
export async function dhan(path: string, body: object): Promise<any> {
  const key = path + JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const isChart = path.startsWith('/charts/');
  const task = (isChart ? chartQueue : queue).catch(() => {}).then(async () => {
    // Chart data has its own budget; option-chain throttling must not block clicks.
    if (isChart) {
      const delay = 250 - (Date.now() - lastChart);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastChart = Date.now();
    }
    if (path === '/optionchain') {
      const delay = 3100 - (Date.now() - lastChain);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastChain = Date.now();
    }
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
  if (isChart) chartQueue = task;
  else queue = task;
  cache.set(key, { expires: Date.now() + (path.includes('charts') ? 15000 : path.includes('expiry') ? 300000 : 5000), promise: task });
  task.catch(() => cache.delete(key));
  if (cache.size > 300) for (const [k,v] of cache) if(v.expires < Date.now()) cache.delete(k);
  return task;
}
